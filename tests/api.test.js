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
    insertRowsBefore: (r, n) => s.rows.splice(r - 1, 0, ...Array.from({ length: n }, () => [])),
    deleteRow: r => s.rows.splice(r - 1, 1),
    setFrozenRows() {}
  };
  return s;
}

const zlib = require('node:zlib');
const blob = (buf, type) => ({ getBytes: () => Array.from(buf), getDataAsString: () => buf.toString('utf8'), type });
function fakeCache() {
  const store = new Map();
  return {
    store,
    get: k => store.get(k) ?? null,
    getAll: keys => Object.fromEntries(keys.filter(k => store.has(k)).map(k => [k, store.get(k)])),
    putAll: obj => Object.entries(obj).forEach(([k, v]) => store.set(k, v))
  };
}

function load() {
  const cache = fakeCache();
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
    CacheService: { getScriptCache: () => cache },
    Utilities: {
      newBlob: (data, type) => blob(typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data), type),
      gzip: b => blob(zlib.gzipSync(Buffer.from(b.getBytes())), 'application/x-gzip'),
      ungzip: b => blob(zlib.gunzipSync(Buffer.from(b.getBytes())), 'application/octet-stream'),
      base64Encode: bytes => Buffer.from(bytes).toString('base64'),
      base64Decode: str => Array.from(Buffer.from(str, 'base64'))
    },
    console: { ...console, warn() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  return { ctx, sheets, cache };
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

function loadWithClaude(reply) {
  const env = load();
  const sent = [];
  env.ctx.PropertiesService = { getScriptProperties: () => ({ getProperty: k => ({ TOKEN: 'secret', ANTHROPIC_API_KEY: 'sk-test' })[k] ?? null }) };
  env.ctx.UrlFetchApp = { fetch: (url, opt) => { sent.push(JSON.parse(opt.payload)); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(reply) }; } };
  return { ...env, sent };
}

test('текст скрина (OCR на iPhone) → Claude получает только текст, расход токенов пишется', () => {
  const reply = {
    stop_reason: 'end_turn', usage: { input_tokens: 612, output_tokens: 95 },
    content: [{ type: 'text', text: JSON.stringify({ kind: 'transfer_out', method: 'qr', recipient: 'person', amount: 45, currency: 'KGS', merchant: 'Асан Б.', date: '2026-09-29T08:10', bank: 'O!Dengi', category: 'Переводы' }) }]
  };
  const { ctx, sheets, sent } = loadWithClaude(reply);
  const ocr = 'Перевод выполнен\n45,00 с\nПолучатель: Асан Б.\n29.09.2026 08:10';
  const r = res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', text: ocr, source: 'screenshot' }) } }));
  assert.equal(r.ok, true, r.message);
  const content = sent[0].messages[0].content;
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'text');
  assert.ok(content[0].text.includes('<receipt>') && content[0].text.includes('Асан Б.'));
  const row = sheets['Транзакции'].rows.at(-1);
  assert.equal(row[1], 45);
  assert.equal(row[4], 'Транспорт');                       // правило маршрутки
  const raw = JSON.parse(row[7]);
  assert.equal(raw.ai_input, 'text');
  assert.deepEqual({ ...raw.ai_tokens }, { in: 612, out: 95 });
  assert.equal(raw.text, undefined);                         // сам текст в таблицу не пишем
});

test('пустой OCR-текст — понятная ошибка без вызова Claude', () => {
  const { ctx, sent } = loadWithClaude({});
  const r = res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', text: '  ' }) } }));
  assert.equal(r.ok, false);
  assert.match(r.message, /текста/);
  assert.equal(sent.length, 0);
});

test('import: дубли с Apple Pay отсекаются, категории по правилам и маршрутке, повторный импорт ничего не добавляет', () => {
  const { ctx, sheets } = load();
  const tx = sheets['Транзакции'].rows;
  const applePayTime = new Date('2026-09-28T13:05:00+06:00');
  tx.push([applePayTime, 102, 'KGS', 'Globus Express', 'Продукты', 'Simbank', 'apple-pay', '{}']);
  const post = b => res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', ...b }) } }));
  const rows = [
    { date: '2026-09-28T13:08:12+06:00', amount: 102, merchant: 'Globus', method: 'card', recipient: 'business' },   // дубль Apple Pay (3 мин)
    { date: '2026-09-28T13:09:40+06:00', amount: 102, merchant: 'Globus', method: 'card', recipient: 'business' },   // вторая такая же покупка — не дубль
    { date: '2026-09-28T18:00:00+06:00', amount: 45, merchant: 'Асан Б.', method: 'qr', recipient: 'person' },        // маршрутка
    { date: '2026-09-28T19:00:00+06:00', amount: 210, merchant: 'Комиссия Simbank', method: 'other', recipient: 'business', category: 'Кредит и комиссии' },
    { date: '2026-09-28T20:00:00+06:00', amount: 999, merchant: 'Непонятное место', method: 'card', recipient: 'business' }
  ];
  const r1 = post({ action: 'import', bank: 'Simbank', card: 'Simbank', rows });
  assert.equal(r1.ok, true);
  assert.equal(r1.added, 4);
  assert.equal(r1.duplicates, 1);
  assert.equal(r1.uncategorized, 1);                     // только «Непонятное место»: Globus есть в правилах
  const added = tx.slice(-4);
  assert.deepEqual(added.map(r => r[4]), ['Продукты', 'Транспорт', 'Кредит и комиссии', 'Без категории']);
  const r2 = post({ action: 'import', bank: 'Simbank', card: 'Simbank', rows });
  assert.equal(r2.added, 0);
  assert.equal(r2.duplicates, 5);
});

test('categorizeUnknown: один запрос к Claude, категории проставлены и запомнены правилами', () => {
  const reply = { stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 120 },
    content: [{ type: 'text', text: JSON.stringify({ items: [{ merchant: 'Азия', category: 'Продукты' }, { merchant: 'Шоро', category: 'Кафе и еда' }] }) }] };
  const { ctx, sheets, sent } = loadWithClaude(reply);
  const tx = sheets['Транзакции'].rows;
  tx.push([new Date(), 200, 'KGS', 'Азия', 'Без категории', '', 'statement', '{}']);
  tx.push([new Date(), 50, 'KGS', 'Шоро', 'Без категории', '', 'statement', '{}']);
  tx.push([new Date(), 70, 'KGS', 'Азия', 'Без категории', '', 'statement', '{}']);
  const r = res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', action: 'categorizeUnknown' }) } }));
  assert.equal(r.ok, true, r.message);
  assert.equal(sent.length, 1);
  assert.match(sent[0].messages[0].content[0].text, /1\. Азия\n2\. Шоро/);
  assert.deepEqual(tx.slice(-3).map(x => x[4]), ['Продукты', 'Кафе и еда', 'Продукты']);
  assert.equal(r.updated, 3);
  assert.deepEqual(sheets['Правила'].rows.slice(1, 3), [['азия', 'Продукты'], ['шоро', 'Кафе и еда']]);
});

test('кэш приложения: второй запрос из кэша, после покупки кэш уже содержит новую операцию', () => {
  const { ctx } = load();
  const get = () => res(ctx.doGet({ parameter: { action: 'data', token: 'secret' } }));
  const first = get();
  assert.equal(first.cached, false);
  const second = get();
  assert.equal(second.cached, true);
  assert.deepEqual(second.transactions.map(t => t.id), first.transactions.map(t => t.id));

  const r = res(ctx.doPost({ postData: { contents: JSON.stringify({ token: 'secret', amount: 'KGS 52,00', merchant: 'Globus Express', card: 'Visa' }) } }));
  assert.equal(r.ok, true);
  const third = get();
  assert.equal(third.cached, true);                           // пересобран сразу после записи
  assert.ok(third.transactions.some(t => t.merchant === 'Globus Express' && t.amount === 52));
});

test('кэш: большие данные режутся на куски и собираются обратно', () => {
  const { ctx, sheets, cache } = load();
  const tx = sheets['Транзакции'].rows;
  for (let i = 0; i < 12000; i++) tx.push([new Date(Date.now() - i * 60000), 100 + i, 'KGS', 'Магазин ' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2), 'Продукты', 'Card', 'statement', '{}']);
  const first = res(ctx.doGet({ parameter: { action: 'data', token: 'secret' } }));
  assert.equal(Number(cache.store.get('data:v1')) >= 2, true);   // больше одного куска
  const second = res(ctx.doGet({ parameter: { action: 'data', token: 'secret' } }));
  assert.equal(second.cached, true);
  assert.equal(second.transactions.length, first.transactions.length);
});
