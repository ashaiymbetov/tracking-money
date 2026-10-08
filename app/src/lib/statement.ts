import { isMbank, parseMbankPages, summarizeMbank } from './mbank';

/**
 * Разбор PDF-выписки прямо на телефоне (файл никуда не отправляется).
 * Поддержаны Simbank «Выписка по карте» и MBank «Выписка по счёту» (разбор MBank — в mbank.ts).
 *
 * Выписка Simbank «ВЫПИСКА ПО КАРТЕ»: колонки «Дата | Детали операции | Сумма |
 * Плата за кредит | Баланс после операции». Длинные «Детали» переносятся на несколько строк — иногда
 * выше даты, — поэтому строки собираем не построчно, а по координатам: каждая сумма — это одна операция,
 * а куски деталей относим к ближайшей по высоте сумме.
 */

export interface PdfItem { str: string; x: number; y: number; w: number }
export type PdfPage = PdfItem[];

export interface StatementRow {
  /** ISO с часовым поясом Бишкека: 2025-10-07T11:37:02+06:00 */
  date: string;
  /** Отрицательная — расход, положительная — поступление. */
  amount: number;
  /** Комиссия банка, если была («Плата за кредит»). */
  fee: number;
  details: string;
}

export interface StatementExpense {
  date: string;
  amount: number;
  merchant: string;
  method: 'qr' | 'card' | 'other';
  recipient: 'person' | 'business' | 'unknown';
  category?: string;
}

/** Списания, которые не расходы и не импортируются: переводы себе, обмен валюты, снятие наличных. */
export interface ExcludedGroup { label: string; count: number; amount: number }

export interface ParsedStatement {
  bank: string;
  period: string;
  rows: StatementRow[];
  expenses: StatementExpense[];
  income: StatementRow[];
  excluded: ExcludedGroup[];
  /** Сумма всех списаний по выписке (расходы + не импортируемые). */
  debits: number;
  /** Итог списаний из самой выписки — для сверки с тем, что мы насчитали. */
  declaredSpent: number | null;
}

export class StatementError extends Error {}

const DATE = /^\d{2}-\d{2}-\d{4}$/;
const TIME = /^\d{2}:\d{2}:\d{2}$/;
const MONEY = /^[+-]?\d{1,3}(?:[\s ]\d{3})*,\d{2}$/;

export function parseMoney(s: string): number {
  return Number(s.replace(/[\s ]/g, '').replace(',', '.'));
}

interface Columns { headerY: number; detailsFrom: number; amountFrom: number; feeFrom: number; balanceFrom: number }

function findColumns(page: PdfPage): Columns | null {
  const find = (s: string) => page.find(i => i.str.trim() === s);
  const details = find('Детали операции');
  const amount = find('Сумма');
  const fee = find('Плата за');
  const balance = find('Баланс после');
  if (!details || !amount || !fee || !balance) return null;
  return {
    headerY: Math.min(details.y, amount.y) - 4,
    // детали выровнены по центру своей колонки и бывают шире заголовка
    detailsFrom: details.x - 40,
    amountFrom: amount.x - 25,
    feeFrom: fee.x - 10,
    balanceFrom: balance.x - 15
  };
}

/** Страницы с координатами → строки операций. Чистая функция. */
export function parseSimbankPages(pages: PdfPage[]): { rows: StatementRow[]; period: string; declaredSpent: number | null } {
  const all = pages.flat().map(i => i.str).join('\n');
  if (!/ВЫПИСКА ПО КАРТЕ/.test(all) || !/Детали операции/.test(all)) {
    throw new StatementError('Не похоже на выписку Simbank. Пока поддерживается только «Выписка по карте» Simbank.');
  }
  const period = /Период:\s*([\d-]+\s*-\s*[\d-]+)/.exec(all)?.[1] ?? '';
  const spentMatch = /Сумма расходных операций по карте:\s*([\d\s ]+,\d{2})/.exec(all);
  const declaredSpent = spentMatch ? parseMoney(spentMatch[1]) : null;

  const rows: StatementRow[] = [];
  let cols: Columns | null = null;
  for (const page of pages) {
    cols = findColumns(page) ?? cols;          // на каждой странице шапка повторяется, но на всякий случай помним прошлую
    if (!cols) continue;
    const c = cols;
    const body = page.filter(i => i.str.trim() && i.y < c.headerY);

    const amounts = body.filter(i => i.x >= c.amountFrom && i.x < c.feeFrom && MONEY.test(i.str.trim()));
    const dates = body.filter(i => i.x < c.detailsFrom && DATE.test(i.str.trim()));
    const times = body.filter(i => i.x < c.detailsFrom && TIME.test(i.str.trim()));
    const fees = body.filter(i => i.x >= c.feeFrom && i.x < c.balanceFrom);
    const details = body.filter(i => i.x >= c.detailsFrom && i.x < c.amountFrom);

    const nearest = <T extends PdfItem>(list: T[], y: number, maxDy: number) =>
      list.reduce<T | null>((best, it) => {
        const d = Math.abs(it.y - y);
        return d <= maxDy && (!best || d < Math.abs(best.y - y)) ? it : best;
      }, null);

    const pageRows = amounts
      .sort((a, b) => b.y - a.y)
      .map(a => {
        const date = nearest(dates, a.y + 7, 12);
        const time = nearest(times, a.y - 7, 12);
        const fee = nearest(fees, a.y, 4);
        return { a, date, time, fee, parts: [] as PdfItem[] };
      });
    if (!pageRows.length) continue;

    // Кусок деталей — к ближайшей по высоте операции.
    for (const d of details) {
      let best = pageRows[0];
      for (const r of pageRows) if (Math.abs(r.a.y - d.y) < Math.abs(best.a.y - d.y)) best = r;
      best.parts.push(d);
    }

    for (const r of pageRows) {
      if (!r.date) continue;                   // сумма без даты — не операция (например, итог)
      const [dd, mm, yyyy] = r.date.str.trim().split('-');
      const time = r.time?.str.trim() ?? '12:00:00';
      const text = r.parts
        .sort((p, q) => q.y - p.y || p.x - q.x)
        .map(p => p.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const feeStr = r.fee?.str.trim() ?? '-';
      rows.push({
        date: `${yyyy}-${mm}-${dd}T${time}+06:00`,
        amount: parseMoney(r.a.str.trim()),
        fee: MONEY.test(feeStr) ? Math.abs(parseMoney(feeStr)) : 0,
        details: text
      });
    }
  }
  return { rows, period, declaredSpent };
}

const PERSON = /^[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?\s+[А-ЯЁA-Z]\.(?:\s*[А-ЯЁA-Z]\.)?$|^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|кызы|уулу)$/;

/** Операция из выписки → расход для импорта (продавец, способ оплаты, частное лицо или нет). */
export function toExpense(row: StatementRow): StatementExpense {
  let text = row.details;
  let method: StatementExpense['method'] = 'card';
  const qr = /^Покупка по QR\s*-\s*/i.exec(text);
  if (qr) { method = 'qr'; text = text.slice(qr[0].length); }
  let category: string | undefined;
  if (/^Списание % по кредиту/i.test(text)) { text = 'Проценты по кредиту'; category = 'Кредит и комиссии'; method = 'other'; }
  // «Глобус 15 Калыка Акиева» → «Глобус»: адрес после названия не нужен для правил и сводки
  text = text.replace(/\s+\d+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+$/, '');
  text = text.replace(/^["«']+|["»']+$/g, '').trim();     // "Stolovaya BlokPitaniya " → Stolovaya BlokPitaniya
  const recipient: StatementExpense['recipient'] = PERSON.test(text) ? 'person'
    : /^(ОсОО|ИП|ОАО|ЗАО|ОО)\s/i.test(text) || method === 'card' ? 'business' : 'unknown';
  return { date: row.date, amount: Math.abs(row.amount), merchant: text || 'Без названия', method, recipient, category };
}

export function summarizeStatement(parsed: { rows: StatementRow[]; period: string; declaredSpent: number | null }): ParsedStatement {
  const expenses: StatementExpense[] = [];
  for (const r of parsed.rows) {
    if (r.amount >= 0) continue;
    // «Плата за кредит» уже входит в сумму (−7 210 = перевод 7 000 + комиссия 210) — делим на две записи.
    const fee = Math.min(r.fee, Math.abs(r.amount));
    const main = toExpense({ ...r, amount: r.amount + fee });
    if (main.amount > 0) expenses.push(main);
    if (fee > 0) expenses.push({ date: r.date, amount: fee, merchant: 'Комиссия Simbank', method: 'other', recipient: 'business', category: 'Кредит и комиссии' });
  }
  return {
    bank: 'Simbank',
    period: parsed.period,
    rows: parsed.rows,
    expenses,
    income: parsed.rows.filter(r => r.amount > 0),
    excluded: [],
    debits: parsed.rows.reduce((s, r) => s + (r.amount < 0 ? -r.amount : 0), 0),
    declaredSpent: parsed.declaredSpent
  };
}

/** Узнаёт банк по тексту выписки и разбирает её. */
export function parseStatement(pages: PdfPage[]): ParsedStatement {
  const text = pages.flat().map(i => i.str).join('\n');
  if (isMbank(text)) return summarizeMbank(parseMbankPages(pages));
  if (/ВЫПИСКА ПО КАРТЕ/.test(text) && /Детали операции/.test(text)) return summarizeStatement(parseSimbankPages(pages));
  throw new StatementError('Не узнал выписку. Поддерживаются «Выписка по карте» Simbank и «Выписка по счёту» MBank (PDF из приложения банка).');
}

/** Читает PDF в браузере (pdf.js грузится только здесь — отдельным чанком). */
export async function readPdfPages(file: File | ArrayBuffer): Promise<PdfPage[]> {
  await import('./streamPolyfill');                        // до pdf.js: нужен Safari на iOS 18
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Свой воркер: тот же pdf.js, но с полифилом внутри (в воркере свой глобальный объект).
  const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  try {
    const doc = await task.promise;
    const pages: PdfPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.flatMap(it => ('str' in it
        ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }]
        : [])));
    }
    return pages;
  } finally {
    await task.destroy();
    worker.terminate();
    pdfjs.GlobalWorkerOptions.workerPort = null;
  }
}
