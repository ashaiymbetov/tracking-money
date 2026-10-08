/**
 * Выписка MBank «Account statement / Выписка по счёту»: колонки «Дата операции | Описание | Сумма».
 * У каждой операции первая строка описания — её тип («Card operations:», «Transfer by phone number QR:»…),
 * ниже — подробности (терминал и магазин, телефон и имя получателя). Подробности идут под датой, поэтому
 * всё, что ниже даты и выше следующей, относится к ней.
 */
import { StatementError, type ExcludedGroup, type ParsedStatement, type PdfItem, type PdfPage, type StatementExpense, type StatementRow } from './statement';

const DATE_TIME = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/;
const SIGNED_MONEY = /^([+-])\s*(\d{1,3}(?:[\s ]\d{3})*,\d{2})$/;
const money = (s: string) => Number(s.replace(/[\s ]/g, '').replace(',', '.'));

export function isMbank(text: string): boolean {
  return /mbank\.kg|ОАО\s*"МБАНК"/i.test(text) && /Account statement|Выписка по сч[её]ту/i.test(text);
}

export interface MbankRow extends StatementRow { type: string }

/** Страницы → операции. Чистая функция. */
export function parseMbankPages(pages: PdfPage[]): { rows: MbankRow[]; period: string; declaredSpent: number | null; client: string } {
  const all = pages.flat();
  const text = all.map(i => i.str).join('\n');
  if (!isMbank(text)) throw new StatementError('Не похоже на выписку MBank');
  const period = /(?:period from|период[а]?\s+с)\s*([\d.]+)\s*(?:to|по)\s*([\d.]+)/i.exec(text);

  // «Total Debits 588 807,34 KGS» — итог списаний, сверяемся с ним.
  let declaredSpent: number | null = null;
  let totalsY: { page: number; y: number } | null = null;
  pages.forEach((page, p) => {
    const label = page.find(i => /^(Total Debits|Итого списани|Всего списани|Расход)/i.test(i.str.trim()));
    if (!label) return;
    const value = page.find(i => i !== label && Math.abs(i.y - label.y) < 3 && i.x > label.x && /\d,\d{2}/.test(i.str));
    if (value) declaredSpent = money(value.str.replace(/[^\d\s ,]/g, '').trim());
    totalsY ??= { page: p, y: label.y + 3 };
  });

  // Имя клиента — под меткой «Client»/«Клиент»: нужно, чтобы узнать переводы самому себе.
  const clientLabel = all.find(i => /^(Client|Клиент)$/i.test(i.str.trim()));
  const client = clientLabel
    ? pages[0].filter(i => Math.abs(i.x - clientLabel.x) < 6 && i.y < clientLabel.y && i.y > clientLabel.y - 50).sort((a, b) => b.y - a.y).map(i => i.str.trim()).join(' ')
    : '';

  const rows: (MbankRow & { y: number; parts: PdfItem[] })[] = [];
  pages.forEach((page, p) => {
    const header = page.find(i => /^(Transaction date|Дата операции|Дата)$/i.test(i.str.trim()));
    if (!header) return;                                        // последняя страница — реквизиты банка
    const stopY = totalsY && totalsY.page === p ? totalsY.y : -Infinity;
    if (totalsY && p > totalsY.page) return;
    const body = page.filter(i => i.str.trim() && i.y < header.y - 3 && i.y > stopY);
    const dates = body.filter(i => i.x < header.x + 60 && DATE_TIME.test(i.str.trim())).sort((a, b) => b.y - a.y);
    const mine = dates.map(d => {
      const [, dd, mm, yyyy, hh, mi, ss] = DATE_TIME.exec(d.str.trim())!;
      return { y: d.y, date: `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss ?? '00'}+06:00`, amount: NaN, fee: 0, details: '', type: '', parts: [] as PdfItem[] };
    });
    for (const i of body) {
      if (dates.includes(i)) continue;
      const owner = [...mine].reverse().find(r => r.y + 3 >= i.y);    // ближайшая дата выше (или на той же строке)
      const target = owner ?? rows[rows.length - 1];                  // хвост операции с прошлой страницы
      if (!target) continue;
      const m = SIGNED_MONEY.exec(i.str.trim());
      if (m && owner && Math.abs(i.y - owner.y) < 3) owner.amount = (m[1] === '-' ? -1 : 1) * money(m[2]);
      else if (i.x > header.x + 60) target.parts.push(i);
    }
    rows.push(...mine);
  });

  const out: MbankRow[] = rows.filter(r => !isNaN(r.amount)).map(r => {
    const parts = r.parts.sort((a, b) => b.y - a.y || a.x - b.x);
    const first = parts.find(i => Math.abs(i.y - r.y) < 3);
    const type = first?.str.trim().replace(/:$/, '') ?? '';
    const details = parts.filter(i => i !== first).map(i => i.str.trim()).join(' ').replace(/\s+/g, ' ').trim();
    return { date: r.date, amount: r.amount, fee: 0, details, type };
  });
  return { rows: out, period: period ? `${period[1]} - ${period[2]}` : '', declaredSpent, client };
}

// ---------------------------------------------------------------------------

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
};
const latin = (s: string) => s.toLowerCase().split('').map(c => TRANSLIT[c] ?? c).join('');

/** «Асан И.» — это клиент «IVANOV ASAN BEKOVICH» (или «Иванов Асан Бекович»)? */
export function isClientName(name: string, client: string): boolean {
  const m = /^([А-ЯЁA-Z][а-яёa-zңөү]+)\s+([А-ЯЁA-ZҢӨҮ])/.exec(name.trim());
  if (!m || !client) return false;
  const tokens = client.split(/\s+/).map(t => latin(t)).filter(Boolean);
  const first = latin(m[1]);
  const initial = latin(m[2]);
  // Фамилия в выписке идёт первой: «SHAYYMBETOV ABYL RYSBEKOVICH», в переводах — «Абыл Ш.»
  return tokens.slice(1).includes(first) && tokens[0].startsWith(initial);
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-zа-яёңөү])/g, (_, a, b) => a + b.toUpperCase());
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{8}-[0-9a-f-]{4,}/gi;
const clean = (s: string) => s.replace(UUID, '').replace(/\\"/g, '"').replace(/\\/g, '').replace(/^["«\s]+|["»\s]+$/g, '').replace(/\s+/g, ' ').trim();
const UTILITIES = /энерго|газ|водоканал|тазалык|тепло|жкх|тсж|бипэс|чупэс/i;

/** Магазин из «TT100038\KGZ\Bishkek\Moskovskaya\TULPAR-CARD\ TT100038\» → «TULPAR-CARD». */
export function cardMerchant(details: string): string {
  const seg = details.split('\\').map(s => s.trim()).filter(Boolean);
  const name = seg.length >= 5 ? seg[4] : seg.filter(s => !/^[A-Z]{0,3}\d{5,}$/.test(s) && !/^[A-Z]{3}$/.test(s)).pop() ?? '';
  return name.replace(/^[A-Z]{2,4}\*/, '').replace(/(?<=[A-Z]{4,})\d+$/, '').trim();
}

/** Телефон и имя из «Перевод по номеру телефона qr. 996502571133/ Тариэл Б./ / Сумма …». */
function phoneAndName(details: string): { phone: string; name: string } {
  const m = /(996\d{9})\/\s*([^/]+?)\s*\//.exec(details);
  return { phone: m?.[1] ?? '', name: m ? clean(m[2]) : '' };
}

type Decision =
  | { kind: 'expense'; expense: StatementExpense }
  | { kind: 'income' }
  | { kind: 'own' }
  | { kind: 'cash'; amount: number };

/** Операция MBank → расход, поступление, перевод себе или снятие наличных. */
export function classifyMbank(row: MbankRow, ownPhones: Set<string>): Decision {
  if (row.amount >= 0) return { kind: 'income' };
  const amount = Math.abs(row.amount);
  const t = row.type;
  const d = row.details;
  const expense = (merchant: string, method: StatementExpense['method'], recipient: StatementExpense['recipient'], category?: string): Decision =>
    ({ kind: 'expense', expense: { date: row.date, amount, merchant: merchant || t || 'Без названия', method, recipient, category } });

  if (/own account|между (своими )?счетами|конвертац/i.test(t + ' ' + d)) return { kind: 'own' };
  if (/cash withdrawal|выдача наличных|снятие наличных/i.test(t)) return { kind: 'cash', amount };

  if (/card operations|операции по карте|оплата картой/i.test(t)) return expense(cardMerchant(d) || 'Оплата картой', 'card', 'business');

  if (/transfer by phone|перевод по номеру/i.test(t)) {
    const { phone, name } = phoneAndName(d);
    if (ownPhones.has(phone)) return { kind: 'own' };
    return expense(name, /qr/i.test(t) ? 'qr' : 'other', 'person');
  }

  // «Перевод по QR»: «…/O!Bank - ШЕРНАЗАР С./154.00 …» — человек; «Оплата по QR»: «KFC - Kant/KFC - Kant/…» — магазин.
  if (/^перевод по qr/i.test(t)) {
    const m = /\s-\s([^/]+?)\/[\d.,]+/.exec(d);
    return expense(m ? titleCase(clean(m[1])) : 'Перевод по QR', 'qr', 'person');
  }
  if (/^оплата по qr/i.test(t)) {
    const m = /Оплата по QR\.\s*([^/]+)\//i.exec(d);
    return expense(m ? clean(m[1]) : 'Оплата по QR', 'qr', 'business');
  }
  if (/^qr payment/i.test(t)) {
    const seg = d.split('/');
    return expense(clean(seg[1] ?? ''), 'qr', 'business');
  }
  if (/mpay/i.test(t)) {
    // «Платеж по MPay. 996…/ OTP ОСОО ДОРДОЙ-СИТИ/ Cinematica <id>/ Сумма» → Cinematica;
    // «…/ CASH OUT TO GO АРЕНДА САМОКАТОВ ОСОО "АРЕНДА СЕРВИС"/ <id>/ …» → Аренда самокатов
    const seg = d.split('/').map(s => s.trim());
    const extra = clean(seg[2] ?? '').replace(/^Сумма.*$/i, '');
    const org = clean((seg[1] ?? '').replace(/^(OTP|CASH OUT TO GO)\s+/i, ''));
    const short = org.split(/\s+(?:ОСОО|ОАО|ЗАО|ИП)\s+/)[0].replace(/^(ОСОО|ОАО|ЗАО|ИП)\s+/, '');
    return expense(extra && /[A-Za-zА-Яа-я]{3}/.test(extra) ? extra : titleCase(clean(short)), 'other', 'business');
  }
  // Пополнение кошелька O!Bank: своего — перевод себе, чужого — перевод.
  if (/^o!\s?bank/i.test(t)) {
    const phone = /Получатель: O!Bank\.\s*(996\d{9})/i.exec(d)?.[1] ?? '';
    if (ownPhones.has(phone)) return { kind: 'own' };
    return expense('Пополнение O!Bank', 'other', 'unknown', 'Переводы');
  }
  // Остальное — оплата услуг: «Оплата услуг. Получатель: Энергосбыт(…). 450092100/1,263.36 …».
  const receiver = /Получатель:\s*(.+?)\.\s/.exec(d)?.[1] ?? t;
  const name = clean(receiver);
  return expense(name, 'other', 'business', UTILITIES.test(name) ? 'Коммуналка' : undefined);
}

export function summarizeMbank(parsed: ReturnType<typeof parseMbankPages>): ParsedStatement {
  // Свои номера — те, с которых приходили переводы от самого клиента («Абыл Ш.» = SHAYYMBETOV ABYL).
  const ownPhones = new Set<string>();
  for (const r of parsed.rows) {
    if (r.amount <= 0 || !/transfer by phone|перевод по номеру/i.test(r.type)) continue;
    const { phone, name } = phoneAndName(r.details);
    if (phone && isClientName(name, parsed.client)) ownPhones.add(phone);
  }

  const expenses: StatementExpense[] = [];
  const own: ExcludedGroup = { label: 'Свои счета и обмен валюты', count: 0, amount: 0 };
  const cash: ExcludedGroup = { label: 'Снятие наличных', count: 0, amount: 0 };
  for (const r of parsed.rows) {
    const d = classifyMbank(r, ownPhones);
    if (d.kind === 'expense') expenses.push(d.expense);
    else if (d.kind === 'own') { own.count++; own.amount += Math.abs(r.amount); }
    else if (d.kind === 'cash') { cash.count++; cash.amount += d.amount; }
  }
  return {
    bank: 'MBank',
    period: parsed.period,
    rows: parsed.rows,
    expenses,
    income: parsed.rows.filter(r => r.amount > 0),
    excluded: [own, cash].filter(g => g.count > 0),
    debits: parsed.rows.reduce((s, r) => s + (r.amount < 0 ? -r.amount : 0), 0),
    declaredSpent: parsed.declaredSpent
  };
}
