import { describe, expect, it } from 'vitest';
import { parseMoney, parseSimbankPages, summarizeStatement, StatementError, toExpense, type PdfItem } from './statement';

// Синтетическая страница с той же раскладкой колонок, что у выписки Simbank (координаты как у pdf.js: y растёт вверх).
const it_ = (str: string, x: number, y: number): PdfItem => ({ str, x, y, w: str.length * 5 });
const header = [
  it_('ВЫПИСКА ПО КАРТЕ', 221, 726), it_('Период: 02-08-2023 - 29-09-2026', 43, 682),
  it_('Сумма расходных операций по карте: 10 689,44 KGS', 43, 510),
  it_('Дата', 66, 441), it_('Детали операции', 154, 441), it_('Сумма', 315, 441),
  it_('Плата за', 385, 448), it_('кредит', 390, 434), it_('Баланс после', 460, 448), it_('операции', 471, 434)
];
const row = (y: number, date: string, time: string, amount: string, fee: string, details: [string, number][]) => [
  it_(date, 50, y + 7), it_(time, 57, y - 7), it_(amount, 316, y), it_(fee, 411, y), it_('1 000,00', 483, y),
  ...details.map(([s, dy]) => it_(s, 150, y + dy))
];
const page = [
  ...header,
  ...row(403, '06-10-2025', '21:28:02', '+500,00', '-', [['OCT *ABYL ShAIYMBETOV', 0]]),
  ...row(366, '07-10-2025', '11:37:02', '-49,29', '-', [['Globus', 0]]),
  // перенос деталей выше даты и ниже времени
  ...row(300, '19-12-2025', '16:33:52', '-100,00', '-', [['Покупка по QR - ОсОО', 14], ['Международный', 7], ['Клинический Центр', -7], ['Медицины Плода', -14]]),
  ...row(250, '24-11-2025', '12:47:21', '-7 210,00', '210,00', [['Эльвира И.', 0]]),
  ...row(212, '11-02-2026', '00:12:17', '-2 130,00', '-', [['Покупка по QR -', 4], ['Арсыбаева А. Т.', -4]]),
  ...row(174, '01-12-2025', '03:19:00', '-798,15', '-', [['Списание % по', 4], ['кредиту за ноябрь', -4]]),
  ...row(136, '31-10-2025', '14:20:46', '-2,00', '-', [['Покупка по QR - Глобус', 4], ['15 Калыка Акиева', -4]]),
  ...row(98, '01-06-2026', '13:23:00', '-355,00', '-', [['"Stolovaya BlokPitaniya "', 0]]),
  ...row(60, '05-04-2026', '14:06:00', '-45,00', '-', [['Покупка по QR -', 4], ['Асан Б.', -4]])
];

describe('выписка Simbank', () => {
  const parsed = parseSimbankPages([page]);
  const st = summarizeStatement(parsed);

  it('находит все операции, даты и суммы', () => {
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.rows[1]).toMatchObject({ date: '2025-10-07T11:37:02+06:00', amount: -49.29, details: 'Globus' });
    expect(parsed.period).toBe('02-08-2023 - 29-09-2026');
  });

  it('собирает перенесённые детали в правильном порядке', () => {
    expect(parsed.rows[2].details).toBe('Покупка по QR - ОсОО Международный Клинический Центр Медицины Плода');
  });

  it('комиссия уже в сумме: делится на перевод и «Комиссию Simbank», итог сходится с шапкой', () => {
    const fee = st.expenses.filter(e => e.merchant === 'Комиссия Simbank');
    expect(fee).toEqual([expect.objectContaining({ amount: 210, category: 'Кредит и комиссии' })]);
    expect(st.expenses.find(e => e.merchant === 'Эльвира И.')?.amount).toBe(7000);
    expect(st.expenses.reduce((s, e) => s + e.amount, 0)).toBeCloseTo(st.declaredSpent!, 2);
  });

  it('поступления не считаются расходами', () => {
    expect(st.income.map(r => r.amount)).toEqual([500]);
    expect(st.expenses.some(e => e.merchant.includes('ABYL'))).toBe(false);
  });

  it('QR, частные лица, проценты и чистка названий', () => {
    const by = (m: string) => st.expenses.find(e => e.merchant === m);
    expect(by('Арсыбаева А. Т.')).toMatchObject({ method: 'qr', recipient: 'person' });
    expect(by('Асан Б.')).toMatchObject({ method: 'qr', recipient: 'person', amount: 45 });
    expect(by('ОсОО Международный Клинический Центр Медицины Плода')).toMatchObject({ method: 'qr', recipient: 'business' });
    expect(by('Проценты по кредиту')).toMatchObject({ amount: 798.15, category: 'Кредит и комиссии' });
    expect(by('Глобус')).toMatchObject({ amount: 2, method: 'qr' });
    expect(by('Stolovaya BlokPitaniya')).toBeTruthy();
  });

  it('чужой PDF — понятная ошибка', () => {
    expect(() => parseSimbankPages([[it_('Счёт-фактура', 50, 700)]])).toThrow(StatementError);
  });

  it('parseMoney и toExpense', () => {
    expect(parseMoney('-7 210,00')).toBe(-7210);
    expect(parseMoney('+1 500,00')).toBe(1500);
    expect(toExpense({ date: '', amount: -10, fee: 0, details: 'YANDEX.GO' })).toMatchObject({ merchant: 'YANDEX.GO', method: 'card', recipient: 'business' });
  });
});
