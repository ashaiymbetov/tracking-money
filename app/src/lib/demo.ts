import type { AppData, Transaction } from './types';

// Демо-данные: чтобы посмотреть приложение без настройки. Детерминированы (seed), живут в памяти вкладки.
const MERCHANTS: [string, string, number, number, string][] = [
  // merchant, category, min, max, card
  ['Globus Express', 'Продукты', 180, 1400, 'MBank Visa'],
  ['Народный', 'Продукты', 90, 900, 'O!Bank'],
  ['Фрунзе', 'Продукты', 250, 2200, 'MBank Visa'],
  ['Blok Pitaniya', 'Кафе и еда', 180, 450, 'O!Bank'],
  ['Coffee Box', 'Кафе и еда', 160, 320, 'MBank Visa'],
  ['Navat', 'Кафе и еда', 600, 2400, 'Simbank Visa Black'],
  ['Glovo', 'Доставка еды', 450, 1600, 'MBank Visa'],
  ['Tulpar-Card', 'Транспорт', 17, 17, 'Simbank Visa Black'],
  ['Маршрутка', 'Транспорт', 45, 45, 'O!Dengi'],
  ['Yandex Go', 'Такси', 150, 520, 'MBank Visa'],
  ['Apteka Elbrus', 'Здоровье', 120, 900, 'MBank Visa'],
  ['Megacom', 'Связь', 400, 400, 'O!Bank'],
  ['Netflix.com', 'Подписки', 1090, 1090, 'Simbank Visa Black'],
  ['Wildberries', 'Покупки онлайн', 500, 4800, 'MBank Visa'],
  ['Cinematica', 'Развлечения', 350, 900, 'O!Bank'],
  ['Айбек К.', 'Переводы', 300, 3000, 'MBank'],
  ['Мама', 'Не учитывать', 5000, 5000, 'MBank'],
  ['ИП Асанов', 'Без категории', 80, 600, 'O!Dengi']
];

let state: AppData | null = null;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function build(): AppData {
  const rand = rng(42);
  const now = new Date();
  const tx: Transaction[] = [];
  let id = 2;
  for (let back = 200; back >= 0; back--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    const perDay = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < perDay; i++) {
      const m = MERCHANTS[Math.floor(rand() * MERCHANTS.length)];
      if ((m[1] === 'Подписки' || m[1] === 'Связь') && day.getDate() !== 5) continue;
      if (m[1] === 'Не учитывать' && day.getDate() !== 1) continue;
      const hour = 8 + Math.floor(rand() * 14);
      const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Math.floor(rand() * 60));
      if (date > now) continue;
      const amount = m[2] === m[3] ? m[2] : Math.round((m[2] + rand() * (m[3] - m[2])) / 10) * 10;
      tx.push({ id: id++, date: date.toISOString(), amount, currency: 'KGS', merchant: m[0], category: m[1], card: m[4], source: 'demo' });
    }
  }
  return {
    ok: true,
    generatedAt: now.toISOString(),
    currency: 'KGS',
    excludedCategory: 'Не учитывать',
    uncategorized: 'Без категории',
    categories: ['Продукты', 'Кафе и еда', 'Доставка еды', 'Транспорт', 'Такси', 'Здоровье', 'Связь', 'Подписки', 'Покупки онлайн', 'Развлечения', 'Переводы', 'Семья', 'Коммуналка', 'Одежда', 'Дом', 'Другое', 'Без категории', 'Не учитывать'],
    budgets: { 'Кафе и еда': 6000, 'Продукты': 15000, 'Такси': 2500 },
    settings: { fareMax: 50 },
    transactions: tx
  };
}

export async function demoData(): Promise<AppData> {
  state ??= build();
  return structuredClone(state);
}

export async function demoMutate(p: Record<string, unknown>) {
  state ??= build();
  if (p.action === 'setCategory') {
    const t = state.transactions.find(x => x.id === p.id);
    if (t) {
      if (p.remember) state.transactions.forEach(x => { if (x.merchant === t.merchant) x.category = String(p.category); });
      t.category = String(p.category);
    }
  } else if (p.action === 'import') {
    const rows = (p.rows as { date: string; amount: number; merchant: string; category?: string }[]) ?? [];
    let id = Math.max(...state.transactions.map(t => t.id)) + 1;
    for (const r of rows) state.transactions.push({ id: id++, date: new Date(r.date).toISOString(), amount: r.amount, currency: 'KGS', merchant: r.merchant, category: r.category ?? 'Без категории', card: String(p.bank), source: 'statement' });
    return { ok: true, added: rows.length, duplicates: 0, uncategorized: rows.filter(r => !r.category).length, message: `Добавлено ${rows.length} (демо)` };
  } else if (p.action === 'categorizeUnknown') {
    return { ok: true, updated: 0, message: 'В демо Claude не вызывается' };
  } else if (p.action === 'setBudget') {
    const limit = Number(p.limit);
    if (limit > 0) state.budgets[String(p.category)] = limit;
    else delete state.budgets[String(p.category)];
  } else {
    state.transactions.push({
      id: Math.max(...state.transactions.map(t => t.id)) + 1,
      date: new Date().toISOString(),
      amount: Number(p.amount),
      currency: 'KGS',
      merchant: String(p.merchant || 'Без названия'),
      category: String(p.category || 'Без категории'),
      card: '',
      source: 'app'
    });
  }
  return { ok: true, message: 'Сохранено (демо)' };
}
