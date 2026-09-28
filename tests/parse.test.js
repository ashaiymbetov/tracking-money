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
