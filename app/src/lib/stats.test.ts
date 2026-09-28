import { describe, expect, it } from 'vitest';
import { byCategory, byDay, countable, groupByDay, summarize } from './stats';
import type { AppData, Transaction } from './types';

const tx = (id: number, date: string, amount: number, category = 'Продукты', merchant = 'Globus', currency = 'KGS'): Transaction =>
  ({ id, date: new Date(date).toISOString(), amount, currency, merchant, category, card: '', source: '' });

const data = (transactions: Transaction[]): AppData => ({
  ok: true, generatedAt: '', currency: 'KGS', excludedCategory: 'Не учитывать', uncategorized: 'Без категории',
  categories: [], budgets: {}, settings: { fareMax: 50 }, transactions
});

describe('stats', () => {
  it('countable убирает «Не учитывать» и чужую валюту', () => {
    const d = data([tx(1, '2026-09-01T10:00', 100), tx(2, '2026-09-01T11:00', 5000, 'Не учитывать'), tx(3, '2026-09-02T10:00', 5, 'Подписки', 'Netflix', 'USD')]);
    expect(countable(d).map(t => t.id)).toEqual([1]);
  });

  it('summarize сравнивает с тем же днём прошлого месяца и строит прогноз', () => {
    const now = new Date('2026-09-10T12:00');
    const txs = [tx(1, '2026-08-05T10:00', 1000), tx(2, '2026-08-25T10:00', 9000), tx(3, '2026-09-03T10:00', 1500)];
    const s = summarize(txs, { year: 2026, month: 8 }, now);
    expect(s.total).toBe(1500);
    expect(s.prevToDate).toBe(1000);          // 25 августа ещё не наступило «к 10-му числу»
    expect(s.delta).toBeCloseTo(0.5);
    expect(s.perDay).toBe(150);
    expect(s.forecast).toBe(4500);            // 150 × 30 дней
  });

  it('прошлый месяц без прогноза', () => {
    const s = summarize([tx(1, '2026-08-05T10:00', 310)], { year: 2026, month: 7 }, new Date('2026-09-10T12:00'));
    expect(s.forecast).toBeNull();
    expect(s.perDay).toBe(10);
  });

  it('byCategory сортирует по сумме и считает доли', () => {
    const c = byCategory([tx(1, '2026-09-01', 300), tx(2, '2026-09-01', 100, 'Такси'), tx(3, '2026-09-02', 100)]);
    expect(c.map(x => [x.category, x.total, x.count])).toEqual([['Продукты', 400, 2], ['Такси', 100, 1]]);
    expect(c[0].share).toBeCloseTo(0.8);
  });

  it('byDay помечает будущие дни текущего месяца', () => {
    const days = byDay([tx(1, '2026-09-02T09:00', 50)], { year: 2026, month: 8 }, new Date('2026-09-03T12:00'));
    expect(days).toHaveLength(30);
    expect(days[1].total).toBe(50);
    expect(days.filter(d => !d.future)).toHaveLength(3);
  });

  it('groupByDay: новые сверху, «Не учитывать» не входит в итог дня', () => {
    const g = groupByDay([tx(1, '2026-09-01T10:00', 100), tx(2, '2026-09-02T10:00', 50), tx(3, '2026-09-02T12:00', 900, 'Не учитывать')], 'Не учитывать');
    expect(g.map(x => x.total)).toEqual([50, 100]);
    expect(g[0].items.map(t => t.id)).toEqual([3, 2]);
  });
});
