import type { AppData, Transaction } from './types';

export interface MonthKey { year: number; month: number } // month: 0–11

export const monthKey = (d: Date): MonthKey => ({ year: d.getFullYear(), month: d.getMonth() });
export const sameMonth = (a: MonthKey, b: MonthKey) => a.year === b.year && a.month === b.month;
export const shiftMonth = (k: MonthKey, delta: number): MonthKey => {
  const d = new Date(k.year, k.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};
export const daysInMonth = (k: MonthKey) => new Date(k.year, k.month + 1, 0).getDate();

/** Операции, которые считаются расходом: без «Не учитывать» и только в основной валюте. */
export function countable(data: AppData): Transaction[] {
  return data.transactions.filter(t => t.category !== data.excludedCategory && t.currency === data.currency);
}

export function inMonth(txs: Transaction[], k: MonthKey): Transaction[] {
  return txs.filter(t => sameMonth(monthKey(new Date(t.date)), k));
}

export const sum = (txs: Transaction[]) => txs.reduce((s, t) => s + t.amount, 0);

export interface CategoryTotal { category: string; total: number; count: number; share: number }

export function byCategory(txs: Transaction[]): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txs) {
    const e = map.get(t.category) ?? { total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    map.set(t.category, e);
  }
  const all = sum(txs) || 1;
  return [...map.entries()]
    .map(([category, e]) => ({ category, ...e, share: e.total / all }))
    .sort((a, b) => b.total - a.total);
}

export interface MerchantTotal { merchant: string; category: string; total: number; count: number }

export function byMerchant(txs: Transaction[], limit = 10): MerchantTotal[] {
  const map = new Map<string, MerchantTotal>();
  for (const t of txs) {
    const key = t.merchant.trim().toLowerCase();
    const e = map.get(key) ?? { merchant: t.merchant, category: t.category, total: 0, count: 0 };
    e.total += t.amount;
    e.count += 1;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

export interface DayTotal { day: number; total: number; future: boolean }

export function byDay(txs: Transaction[], k: MonthKey, now = new Date()): DayTotal[] {
  const days = daysInMonth(k);
  const totals = new Array<number>(days).fill(0);
  for (const t of txs) totals[new Date(t.date).getDate() - 1] += t.amount;
  const current = sameMonth(k, monthKey(now));
  return totals.map((total, i) => ({ day: i + 1, total, future: current && i + 1 > now.getDate() }));
}

export interface MonthTotal extends MonthKey { total: number }

export function byMonth(txs: Transaction[], end: MonthKey, count = 12): MonthTotal[] {
  const out: MonthTotal[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const k = shiftMonth(end, -i);
    out.push({ ...k, total: sum(inMonth(txs, k)) });
  }
  return out;
}

export interface MonthSummary {
  total: number;
  count: number;
  /** Сколько дней месяца уже прошло (для текущего) или всего дней (для прошлых). */
  elapsedDays: number;
  perDay: number;
  /** Прогноз на весь месяц — только для текущего месяца. */
  forecast: number | null;
  /** Потрачено в прошлом месяце к тому же дню (для сравнения «честно»). */
  prevToDate: number;
  /** Изменение к прошлому месяцу, доля (0.12 = +12 %), null если сравнивать не с чем. */
  delta: number | null;
}

export function summarize(txs: Transaction[], k: MonthKey, now = new Date()): MonthSummary {
  const month = inMonth(txs, k);
  const total = sum(month);
  const current = sameMonth(k, monthKey(now));
  const days = daysInMonth(k);
  const elapsedDays = current ? now.getDate() : days;
  const perDay = elapsedDays ? total / elapsedDays : 0;

  const prevKey = shiftMonth(k, -1);
  const prevDays = daysInMonth(prevKey);
  const cutoff = Math.min(elapsedDays, prevDays);
  const prevToDate = sum(inMonth(txs, prevKey).filter(t => new Date(t.date).getDate() <= cutoff));

  return {
    total,
    count: month.length,
    elapsedDays,
    perDay,
    forecast: current ? perDay * days : null,
    prevToDate,
    delta: prevToDate > 0 ? total / prevToDate - 1 : null
  };
}

export interface DayGroup { key: string; date: Date; total: number; items: Transaction[] }

/** Лента операций по дням, новые сверху. */
export function groupByDay(txs: Transaction[], excluded: string): DayGroup[] {
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date));
  const groups: DayGroup[] = [];
  for (const t of sorted) {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), total: 0, items: [] };
      groups.push(g);
    }
    g.items.push(t);
    if (t.category !== excluded) g.total += t.amount;
  }
  return groups;
}
