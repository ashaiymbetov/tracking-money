import { describe, expect, it } from 'vitest';
import { cardMerchant, isClientName, parseMbankPages } from './mbank';
import { parseStatement, type PdfItem } from './statement';

// Синтетическая выписка с той же раскладкой, что у MBank (координаты как у pdf.js: y растёт вверх). Имена вымышленные.
const t = (str: string, x: number, y: number): PdfItem => ({ str, x, y, w: str.length * 5 });
const head = (y: number) => [t('Transaction date', 52.3, y), t('Transaction description', 239.1, y), t('Transaction Amount', 453.9, y)];
const op = (y: number, date: string, type: string, amount: string, lines: string[]) => [
  t(date, 53.4, y), t(type, 147, y + 0.5), t(amount, 476, y),
  ...lines.map((s, i) => t(s, 147, y - 23 + i * -11.5))
];

const page1 = [
  t('Account statement №1030000000000000', 187.5, 664.9),
  t('For the period from 01.09.2026 to 30.09.2026', 195.2, 624.8),
  t('Client', 41, 560.8), t('IVANOV ASAN', 41, 536.8), t('BEKOVICH', 41, 522.5),
  ...head(474.9),
  ...op(453.4, '01.09.2026 10:00', 'Transfer by phone number:', '+ 5 000,00', ['Перевод по номеру телефона. 996700000001/ Асан И./ / Сумма', '5,000.00 KGS']),
  ...op(392.4, '01.09.2026 12:00', 'O!Bank:', '- 3 000,00', ['Оплата услуг. Получатель: O!Bank. 996700000001/3,000.00', '0a1b2c3d-0000-4000-8000-000000000001/ Сумма 3,000.00 KGS']),
  ...op(343.4, '02.09.2026 09:12', 'Card operations:', '- 17,00', ['TT100038\\KGZ\\Bishkek\\Moskovskaya\\TULPAR-CARD\\ TT100038\\']),
  ...op(300.4, '02.09.2026 13:45', 'Card operations:', '- 1 158,50', ['33596628\\KGZ\\BISHKEK\\195 KIEVSKAYA STR \\GLOBUS 15', 'KALYKA-AKIEV\\ 33596628\\']),
  ...op(250.4, '03.09.2026 08:10', 'Transfer by phone number QR:', '- 45,00', ['Перевод по номеру телефона qr. 996500000002/ Бакыт Т./ / Сумма', '45.00 KGS Счет корреспондента 00020201-00003-417-']),
  ...op(190.4, '03.09.2026 11:00', 'Transfer to own account:', '- 875,00', ['Перевод между счетами; Конвертация валют (из валюты 875 KGS', 'в валюту 10 USD).']),
  ...op(140.4, '04.09.2026 18:00', 'Перевод по QR:', '- 154,00', ['Оплата услуг. Получатель: Перевод по QR.', '996755000003/996755000003/O!Bank - НУРЛАН С./154.00']),
  // операция в самом низу страницы — её описание продолжится на следующей
  ...op(60.4, '05.09.2026 10:27', 'Оплата по QR:', '- 249,00', [])
];
const page2 = [
  ...head(804.9),
  t('Оплата услуг. Получатель: Оплата по QR. KFC - Kant/KFC - Kant/249.00', 147, 790),
  ...op(760.4, '06.09.2026 11:09', 'Энергосбыт(БиПЭС, ЧуПЭС, ТаласПЭС):', '- 1 263,36', ['Оплата услуг. Получатель: Энергосбыт(БиПЭС, ЧуПЭС, ТаласПЭС). 100000001/1,263.36']),
  ...op(700.4, '07.09.2026 13:40', 'Cash withdrawal at QRMBANK ATMs:', '- 2 000,00', ['Выдача наличных в банкоматах QRMBANK. 07.09.2026 13:40/']),
  ...op(650.4, '08.09.2026 19:06', 'MPay payment:', '- 966,00', ['Платеж по MPay. 996000000001/ OTP ОСОО ДОРДОЙ-СИТИ/', 'Cinematica 0a1b2c3d-0000-4000-8000-000000000002/ Сумма 966.00', 'KGS']),
  ...op(590.4, '09.09.2026 22:50', 'Card operations:', '+ 12,49', ['Refund after payment adjustment']),
  t('Total Debits', 33, 371.8), t('9 727,86 KGS', 155, 371.8),
  t('Total Credits', 33, 352.8), t('5 012,49 KGS', 155, 352.8)
];
const footer = [t('www.mbank.kg', 30, 35.6), t('С0082, Кыргызская Республика,', 222, 110.1)];

describe('выписка MBank', () => {
  const parsed = parseMbankPages([page1, page2, footer]);
  const st = parseStatement([page1, page2, footer]);
  const by = (m: string) => st.expenses.find(e => e.merchant === m);

  it('операции, период, итог и клиент', () => {
    expect(parsed.rows).toHaveLength(12);
    expect(parsed.period).toBe('01.09.2026 - 30.09.2026');
    expect(parsed.declaredSpent).toBe(9727.86);
    expect(parsed.client).toBe('IVANOV ASAN BEKOVICH');
    expect(parsed.rows[3]).toMatchObject({ date: '2026-09-02T13:45:00+06:00', amount: -1158.5, type: 'Card operations' });
  });

  it('описание с прошлой страницы приклеивается к своей операции', () => {
    expect(by('KFC - Kant')).toMatchObject({ amount: 249, method: 'qr', recipient: 'business' });
  });

  it('все списания сходятся с итогом выписки', () => {
    expect(st.bank).toBe('MBank');
    expect(st.debits).toBeCloseTo(st.declaredSpent!, 2);
  });

  it('свои счета, пополнение своего O!Bank и наличные не считаются расходами', () => {
    expect(st.excluded).toEqual([
      { label: 'Свои счета и обмен валюты', count: 2, amount: 3875 },
      { label: 'Снятие наличных', count: 1, amount: 2000 }
    ]);
    expect(st.income.map(r => r.amount)).toEqual([5000, 12.49]);
  });

  it('магазины, люди и услуги', () => {
    expect(by('TULPAR-CARD')).toMatchObject({ amount: 17, method: 'card', recipient: 'business' });
    expect(by('GLOBUS 15 KALYKA-AKIEV')).toMatchObject({ amount: 1158.5 });
    expect(by('Бакыт Т.')).toMatchObject({ amount: 45, method: 'qr', recipient: 'person' });
    expect(by('Нурлан С.')).toMatchObject({ amount: 154, method: 'qr', recipient: 'person' });
    expect(by('Энергосбыт(БиПЭС, ЧуПЭС, ТаласПЭС)')).toMatchObject({ category: 'Коммуналка' });
    expect(by('Cinematica')).toMatchObject({ amount: 966 });
    expect(st.expenses).toHaveLength(7);
  });
});

describe('мелочи MBank', () => {
  it('магазин из строки терминала', () => {
    expect(cardMerchant('24531109\\CHN\\SHANGHAI\\No 533 Loushanguan Road Changning District\\FFT*PINDUODUO9\\ 24531109\\')).toBe('PINDUODUO');
    expect(cardMerchant('E1508001\\KGZ\\Bishkek\\Toktogula\\YANDEX.GO\\ E1508001\\')).toBe('YANDEX.GO');
    expect(cardMerchant('J358320\\KGZ\\S LIUKSEMBUR\\UL SOVETSKAIA42\\ASIA 51-2\\ J358320\\')).toBe('ASIA 51-2');
  });

  it('узнаёт клиента по имени и инициалу в любой раскладке', () => {
    expect(isClientName('Асан И.', 'IVANOV ASAN BEKOVICH')).toBe(true);
    expect(isClientName('Асан И.', 'Иванов Асан Бекович')).toBe(true);
    expect(isClientName('Асан Б.', 'IVANOV ASAN BEKOVICH')).toBe(false);  // инициал — фамилии, а не отчества
    expect(isClientName('Айдар И.', 'IVANOV ASAN BEKOVICH')).toBe(false);
  });

  it('незнакомая выписка — понятная ошибка', () => {
    expect(() => parseStatement([[t('Какой-то документ', 10, 10)]])).toThrow(/Не узнал выписку/);
  });
});
