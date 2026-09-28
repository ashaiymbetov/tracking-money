// API для приложения (doGet?action=data, setCategory, setBudget) на фейковой таблице.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeSheet(name, rows) {
  const s = {
    name, rows,
    getLastRow: () => s.rows.length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (s.rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
        getValue: () => (s.rows[r - 1] || [])[c - 1] ?? '',
        setValue: v => { s.rows[r - 1][c - 1] = v; },
        setValues: vals => vals.forEach((row, i) => row.forEach((v, j) => { (s.rows[r - 1 + i] ||= [])[c - 1 + j] = v; })),
        setFontWeight() { return this; }
      };
    },
    appendRow: row => s.rows.push(row),
    insertRowBefore: r => s.rows.splice(r - 1, 0, []),
    deleteRow: r => s.rows.splice(r - 1, 1),
    setFrozenRows() {}
  };
  return s;
}

function load() {
  const sheets = {
    'Транзакции': fakeSheet('Транзакции', [
      ['Дата', 'Сумма', 'Валюта', 'Магазин', 'Категория', 'Карта', 'Источник', 'Исходные данные'],
      [new Date(), 160, 'KGS', 'Apteka Elbrus', 'Здоровье', 'MBank', 'apple-pay', '{}'],
      [new Date(), 45, 'KGS', 'Алтынбек А.', 'Переводы', 'O!Dengi', 'screenshot', '{}'],
      [new Date('2020-01-01'), 999, 'KGS', 'Старьё', 'Продукты', '', '', '{}']
    ]),
    'Правила': fakeSheet('Правила', [['Если…', 'Категория'], ['globus', 'Продукты']])
  };
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = fakeSheet(n, [])),
    toast() {}
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'TOKEN' ? 'secret' : null) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ setMimeType: () => ({ text: t }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  return { ctx, sheets };
}

const res = out => JSON.parse(out.text);

test('doGet data: токен обязателен, старые строки отсекаются', () => {
  const { ctx } = load();
  assert.equal(res(ctx.doGet({ parameter: { action: 'data', token: 'nope' } })).ok, false);
  const d = res(ctx.doGet({ parameter: { action: 'data', token: 'secret' } }));
  assert.equal(d.ok, true);
  assert.deepEqual(d.transactions.map(t => [t.id, t.merchant, t.amount]), [[2, 'Apteka Elbrus', 160], [3, 'Алтынбек А.', 45]]);
  assert.ok(d.categories.includes('Не учитывать'));
  assert.equal(d.settings.fareMax, 50);
});

test('setCategory: меняет строку, remember добавляет правило первым', () => {
  const { ctx, sheets } = load();
  const post = b => res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', ...b }) } }));
  assert.equal(post({ action: 'setCategory', id: 3, merchant: 'Алтынбек А.', category: 'Транспорт', remember: true }).ok, true);
  assert.equal(sheets['Транзакции'].rows[2][4], 'Транспорт');
  assert.deepEqual(sheets['Правила'].rows[1], ['алтынбек а.', 'Транспорт']);
  // защита от сдвига строк
  assert.equal(post({ action: 'setCategory', id: 2, merchant: 'Другой магазин', category: 'Такси' }).ok, false);
  assert.equal(post({ action: 'setCategory', id: 99, category: 'Такси' }).ok, false);
});

test('setBudget: создать, изменить, убрать', () => {
  const { ctx, sheets } = load();
  const post = b => res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', action: 'setBudget', ...b }) } }));
  assert.deepEqual({ ...post({ category: 'Кафе и еда', limit: 6000 }).budgets }, { 'Кафе и еда': 6000 });
  assert.deepEqual({ ...post({ category: 'Кафе и еда', limit: 8000 }).budgets }, { 'Кафе и еда': 8000 });
  assert.deepEqual({ ...post({ category: 'Кафе и еда', limit: 0 }).budgets }, {});
  assert.equal(sheets['Бюджеты'].rows.length, 1);
});
