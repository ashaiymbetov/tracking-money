// Тесты чистых функций из apps-script/Code.gs. Запуск: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
const { parseAmount, normalizeMerchant, categorize, DEFAULT_RULES } = ctx;

const amt = (v) => ({ ...parseAmount(v) });

test('parseAmount: форматы Apple Pay / банков', () => {
  assert.deepEqual(amt('KGS 160,00'), { amount: 160, currency: 'KGS' });
  assert.deepEqual(amt('160,00 KGS'), { amount: 160, currency: 'KGS' });
  assert.deepEqual(amt('3 141,1 KGS'), { amount: 3141.1, currency: 'KGS' });
  assert.deepEqual(amt('3 141,10 KGS'), { amount: 3141.1, currency: 'KGS' });
  assert.deepEqual(amt('$12.50'), { amount: 12.5, currency: 'USD' });
  assert.deepEqual(amt('1,234.56 USD'), { amount: 1234.56, currency: 'USD' });
  assert.deepEqual(amt('1.234,56 €'), { amount: 1234.56, currency: 'EUR' });
  assert.deepEqual(amt('1,234,567'), { amount: 1234567, currency: null });
  assert.deepEqual(amt('-374,00'), { amount: 374, currency: null });
  assert.deepEqual(amt('239 сом'), { amount: 239, currency: 'KGS' });
  assert.deepEqual(amt(160), { amount: 160, currency: null });
  assert.deepEqual(amt('160'), { amount: 160, currency: null });
});

test('parseAmount: мусор', () => {
  assert.equal(parseAmount('').amount, null);
  assert.equal(parseAmount(undefined).amount, null);
  assert.equal(parseAmount('KGS').amount, null);
});

test('normalizeMerchant', () => {
  assert.equal(normalizeMerchant('Apteka Elbrus  Bishkek, Bishkek'), 'Apteka Elbrus');
  assert.equal(normalizeMerchant('Globus Express  Bishkek, Bishkek'), 'Globus Express');
  assert.equal(normalizeMerchant('Blok Pitaniya  Bishkek, Bishkek'), 'Blok Pitaniya');
  assert.equal(normalizeMerchant('MD00APTEKA ELBRUS, BISHKEK'), 'APTEKA ELBRUS');
  assert.equal(normalizeMerchant('Netflix.com'), 'Netflix.com');
  assert.equal(normalizeMerchant(''), 'Неизвестно');
});

test('categorize: примеры со скриншота', () => {
  assert.equal(categorize('Apteka Elbrus', DEFAULT_RULES), 'Здоровье');
  assert.equal(categorize('Globus Express', DEFAULT_RULES), 'Продукты');
  assert.equal(categorize('Blok Pitaniya', DEFAULT_RULES), 'Кафе и еда');
  assert.equal(categorize('Какой-то ИП', DEFAULT_RULES), 'Без категории');
});

test('categorize: первое совпадение побеждает, регистр не важен', () => {
  const rules = [['GLOBUS', 'Продукты'], ['express', 'Другое']];
  assert.equal(categorize('globus express', rules), 'Продукты');
});

test('categorize: транспорт', () => {
  assert.equal(categorize('Tulpar Bishkek', DEFAULT_RULES), 'Транспорт');
  assert.equal(categorize('MP BISHKEKPASSAZHIRTRANSPORT', DEFAULT_RULES), 'Транспорт');
});

const { interpretExtraction, withBishkekOffset, detectMediaType, EXTRACTION_SCHEMA } = ctx;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('interpretExtraction: QR-оплата записывается', () => {
  const r = plain(interpretExtraction({
    kind: 'payment', amount: 350, currency: 'kgs', merchant: 'ИП Асанов (Шаурма)',
    date: '2026-09-28T13:05', bank: 'MBank', category: 'Кафе и еда'
  }));
  assert.equal(r.record, true);
  assert.equal(r.tx.amount, 350);
  assert.equal(r.tx.currency, 'KGS');
  assert.equal(r.tx.suggested_category, 'Кафе и еда');
});

test('interpretExtraction: перевод без имени получателя', () => {
  const r = plain(interpretExtraction({ kind: 'transfer_out', amount: 1000, currency: 'KGS', merchant: '', date: '', bank: '', category: 'Без категории' }));
  assert.equal(r.record, true);
  assert.equal(r.tx.merchant, 'Перевод');
  assert.equal(r.tx.suggested_category, '');
});

test('interpretExtraction: поступления, свои счета и мусор пропускаются', () => {
  for (const kind of ['income', 'transfer_in', 'own_transfer', 'not_a_transaction']) {
    assert.equal(interpretExtraction({ kind, amount: 500, currency: 'KGS' }).record, false, kind);
  }
  assert.equal(interpretExtraction({ kind: 'payment', amount: 0 }).record, false);
  assert.equal(interpretExtraction(null).record, false);
});

test('withBishkekOffset', () => {
  assert.equal(withBishkekOffset('2026-09-28T16:38'), '2026-09-28T16:38:00+06:00');
  assert.equal(withBishkekOffset('2026-09-28 16:38:12'), '2026-09-28T16:38:12+06:00');
  assert.equal(withBishkekOffset('2026-09-28'), '2026-09-28T12:00:00+06:00');
  assert.equal(withBishkekOffset('2026-09-28T10:38:00Z'), '2026-09-28T10:38:00Z');
  assert.equal(withBishkekOffset(''), '');
  assert.equal(withBishkekOffset('вчера'), '');
  assert.ok(!isNaN(new Date(withBishkekOffset('2026-09-28T16:38')).getTime()));
});

test('detectMediaType', () => {
  assert.equal(detectMediaType('/9j/4AAQ'), 'image/jpeg');
  assert.equal(detectMediaType('iVBORw0KGgo'), 'image/png');
  assert.equal(detectMediaType('JVBERi0xLjQ'), 'application/pdf');
});

test('EXTRACTION_SCHEMA: все поля обязательны (требование structured outputs)', () => {
  assert.deepEqual([...EXTRACTION_SCHEMA.required].sort(), Object.keys(EXTRACTION_SCHEMA.properties).sort());
  assert.equal(EXTRACTION_SCHEMA.additionalProperties, false);
});
