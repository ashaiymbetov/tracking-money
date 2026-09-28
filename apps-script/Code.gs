/**
 * Трекер расходов: iPhone (Команды → «Транзакция» Apple Pay) → Google Sheets.
 *
 * Установка — см. README.md. Коротко:
 *   1. Создай Google-таблицу → Расширения → Apps Script → вставь этот файл.
 *   2. Запусти функцию setup() один раз (выдаст токен в журнал).
 *   3. Развернуть → Новое развертывание → Веб-приложение
 *      (Выполнять от: меня, Доступ: все) → скопируй URL.
 *   4. В iPhone настрой автоматизацию «Транзакция», которая шлёт POST на этот URL.
 */

var SHEET_TX = 'Транзакции';
var SHEET_RULES = 'Правила';
var SHEET_SUMMARY = 'Сводка';
var UNCATEGORIZED = 'Без категории';
var EXCLUDED = 'Не учитывать';        // строка остаётся в таблице, но не попадает в сводку
var TRANSPORT = 'Транспорт';
var SHEET_SETTINGS = 'Настройки';
var DEFAULT_FARE_MAX = 50;            // QR-оплата человеку до этой суммы = проезд в маршрутке
var TIMEZONE = 'Asia/Bishkek';
var DEFAULT_CURRENCY = 'KGS';
var DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

var TX_HEADERS = ['Дата', 'Сумма', 'Валюта', 'Магазин', 'Категория', 'Карта', 'Источник', 'Исходные данные'];

// Стартовые правила: подстрока в названии магазина (без учёта регистра) → категория.
// Дальше правь лист «Правила» прямо в таблице.
var DEFAULT_RULES = [
  ['apteka', 'Здоровье'],
  ['аптека', 'Здоровье'],
  ['pharm', 'Здоровье'],
  ['neman', 'Здоровье'],
  ['globus', 'Продукты'],
  ['frunze', 'Продукты'],
  ['narodnyi', 'Продукты'],
  ['narodny', 'Продукты'],
  ['bereket', 'Продукты'],
  ['7days', 'Продукты'],
  ['zhanyl', 'Продукты'],
  ['market', 'Продукты'],
  ['magnum', 'Продукты'],
  ['blok pitaniya', 'Кафе и еда'],
  ['cafe', 'Кафе и еда'],
  ['kafe', 'Кафе и еда'],
  ['coffee', 'Кафе и еда'],
  ['kofe', 'Кафе и еда'],
  ['restoran', 'Кафе и еда'],
  ['restaurant', 'Кафе и еда'],
  ['burger', 'Кафе и еда'],
  ['kfc', 'Кафе и еда'],
  ['pizza', 'Кафе и еда'],
  ['glovo', 'Доставка еды'],
  ['tulpar', 'Транспорт'],
  ['transport', 'Транспорт'],
  ['транспорт', 'Транспорт'],
  ['passazh', 'Транспорт'],
  ['avtobus', 'Транспорт'],
  ['autobus', 'Транспорт'],
  ['yandex go', 'Такси'],
  ['yandex.taxi', 'Такси'],
  ['taxi', 'Такси'],
  ['azs', 'Авто'],
  ['gazprom', 'Авто'],
  ['shell', 'Авто'],
  ['beeline', 'Связь'],
  ['megacom', 'Связь'],
  ['o!', 'Связь'],
  ['netflix', 'Подписки'],
  ['spotify', 'Подписки'],
  ['apple.com', 'Подписки'],
  ['youtube', 'Подписки'],
  ['wildberries', 'Покупки онлайн'],
  ['ozon', 'Покупки онлайн'],
  ['lalafo', 'Покупки онлайн'],
  ['cinema', 'Развлечения'],
  ['kino', 'Развлечения']
];

// ---------------------------------------------------------------------------
// Веб-хук
// ---------------------------------------------------------------------------

function doPost(e) {
  try {
    var body = parseBody_(e);
    var props = PropertiesService.getScriptProperties();
    if (body.token !== props.getProperty('TOKEN')) {
      return fail_('неверный токен (проверь поле token в команде)');
    }

    // Скриншот / чек: сначала распознаём через Claude (вне блокировки — это пара секунд).
    if (body.image) {
      var extracted = extractFromImage_(body.image, body.mime, loadCategories_(getSpreadsheet_()));
      var decision = interpretExtraction(extracted, loadSettings_(getSpreadsheet_()).fareMax);
      if (!decision.record) return json_({ ok: true, skipped: true, message: decision.message });
      body = mergeExtraction_(body, decision.tx);
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var result = addTransaction_(body);
      return json_(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return fail_(String(err && err.message || err));
  }
}

function doGet() {
  return json_({ ok: true, message: 'Трекер расходов работает. Используй POST.' });
}

function parseBody_(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (ignored) {
      // Команды иногда шлют форму, а не JSON.
    }
  }
  return (e && e.parameter) || {};
}

function addTransaction_(body) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);

  var parsed = parseAmount(body.amount);
  if (parsed.amount === null) {
    return { ok: false, error: 'не удалось распознать сумму: ' + body.amount, message: '⚠️ Не удалось распознать сумму: ' + body.amount };
  }
  var currency = cleanText(body.currency) || parsed.currency || DEFAULT_CURRENCY;
  var merchant = normalizeMerchant(body.merchant);
  var card = cleanText(body.card);
  var source = cleanText(body.source) || 'apple-pay';
  var date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime())) date = new Date();

  var category = cleanText(body.category) || categorize(merchant, loadRules_(ss));
  // Правила важнее; подсказка ИИ — только если правила не знают этот магазин.
  if (category === UNCATEGORIZED && cleanText(body.suggested_category)) category = cleanText(body.suggested_category);

  if (isDuplicate_(sheet, date, parsed.amount, merchant)) {
    return { ok: true, duplicate: true, category: category, message: 'Уже записано' };
  }

  sheet.appendRow([date, parsed.amount, currency, merchant, category, card, source, JSON.stringify(stripToken_(body))]);

  return {
    ok: true,
    category: category,
    message: formatAmount_(parsed.amount) + ' ' + currency + ' · ' + merchant + ' → ' + category
  };
}

function isDuplicate_(sheet, date, amount, merchant) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var from = Math.max(2, last - 9);
  var rows = sheet.getRange(from, 1, last - from + 1, 4).getValues();
  for (var i = 0; i < rows.length; i++) {
    var d = rows[i][0];
    if (!(d instanceof Date)) continue;
    if (Math.abs(d.getTime() - date.getTime()) <= DUPLICATE_WINDOW_MS &&
        Number(rows[i][1]) === amount &&
        String(rows[i][3]) === merchant) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Скриншоты и чеки → Claude
// ---------------------------------------------------------------------------

var CLAUDE_MODEL = 'claude-opus-5';
var TX_KINDS = ['payment', 'transfer_out', 'income', 'transfer_in', 'own_transfer', 'not_a_transaction'];
var TX_METHODS = ['qr', 'phone_transfer', 'card', 'other'];
var RECIPIENTS = ['business', 'person', 'self', 'unknown'];

var EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: TX_KINDS },
    method: { type: 'string', enum: TX_METHODS },
    recipient: { type: 'string', enum: RECIPIENTS },
    amount: { type: 'number' },
    currency: { type: 'string' },
    merchant: { type: 'string' },
    date: { type: 'string' },
    bank: { type: 'string' },
    category: { type: 'string' }
  },
  required: ['kind', 'method', 'recipient', 'amount', 'currency', 'merchant', 'date', 'bank', 'category'],
  additionalProperties: false
};

function extractionPrompt_(categories) {
  return [
    'Это скриншот или чек из мобильного банка в Кыргызстане (MBank, O!Bank, Simbank и т. п.).',
    'Извлеки одну операцию:',
    '- kind: payment — оплата покупки/услуги (в т. ч. по QR); transfer_out — перевод другому человеку;',
    '  income — зачисление/поступление; transfer_in — входящий перевод; own_transfer — перевод между своими счетами;',
    '  not_a_transaction — на изображении нет завершённой операции (ошибка, баланс, реклама и т. п.).',
    '- method: qr — оплата/перевод по QR-коду (на чеке есть «QR», «по QR», «ELQR» и т. п.); phone_transfer — перевод',
    '  по номеру телефона или карты; card — оплата картой; other — иное или непонятно.',
    '- recipient: business — магазин, компания, ИП с названием; person — частное лицо (имя и фамилия, «Алтынбек А.»);',
    '  self — сам владелец счёта (перевод себе); unknown — непонятно.',
    '- amount: сумма операции положительным числом (без комиссии, если она указана отдельно); 0, если нет.',
    '- currency: ISO-код (KGS, USD, RUB…); «сом» = KGS.',
    '- merchant: получатель — название магазина/ИП/сервиса, либо имя человека для перевода. Без номера телефона и счёта.',
    '- date: дата и время операции в формате YYYY-MM-DDTHH:MM (по Бишкеку), пустая строка, если не видно.',
    '- bank: банк или приложение, если понятно, иначе пустая строка.',
    '- category: одна из: ' + categories.join(', ') + '. Если ни одна не подходит — «' + UNCATEGORIZED + '».'
  ].join('\n');
}

/** Отправляет изображение (или PDF) в Claude и возвращает распознанный объект по EXTRACTION_SCHEMA. */
function extractFromImage_(base64, mime, categories) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Не задан ANTHROPIC_API_KEY в свойствах скрипта');

  var data = String(base64).replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  var mediaType = cleanText(mime) || detectMediaType(data);
  var fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: data } };

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: extractionPrompt_(categories) }] }]
  };

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());
  if (code !== 200) {
    throw new Error('Claude API ' + code + ': ' + (body.error && body.error.message || res.getContentText()));
  }
  if (body.stop_reason === 'refusal') throw new Error('Claude отказался обрабатывать изображение');
  if (body.stop_reason === 'max_tokens') throw new Error('Ответ Claude обрезан (max_tokens)');

  for (var i = 0; i < body.content.length; i++) {
    if (body.content[i].type === 'text') return JSON.parse(body.content[i].text);
  }
  throw new Error('Claude не вернул текстовый ответ');
}

/**
 * Решает, записывать ли распознанную операцию как расход. Чистая функция.
 * fareMax: QR-оплата частному лицу на сумму до fareMax считается проездом (маршрутки в Бишкеке).
 */
function interpretExtraction(x, fareMax) {
  x = x || {};
  if (fareMax === undefined || fareMax === null || isNaN(Number(fareMax))) fareMax = DEFAULT_FARE_MAX;
  var amount = Number(x.amount);
  if (x.kind === 'not_a_transaction' || !(amount > 0)) {
    return { record: false, message: 'Не нашёл на картинке операцию' };
  }
  if (x.kind === 'income' || x.kind === 'transfer_in') {
    return { record: false, message: 'Это поступление (' + formatAmount_(amount) + ' ' + (x.currency || DEFAULT_CURRENCY) + '), не записал как расход' };
  }
  if (x.kind === 'own_transfer' || x.recipient === 'self') {
    return { record: false, message: 'Перевод между своими счетами — не расход, пропустил' };
  }
  var suggested = cleanText(x.category);
  if (x.method === 'qr' && x.recipient === 'person' && amount <= Number(fareMax)) suggested = TRANSPORT;
  return {
    record: true,
    tx: {
      amount: amount,
      currency: cleanText(x.currency).toUpperCase() || DEFAULT_CURRENCY,
      merchant: cleanText(x.merchant) || (x.kind === 'transfer_out' ? 'Перевод' : 'Неизвестно'),
      date: cleanText(x.date),
      bank: cleanText(x.bank),
      kind: x.kind,
      method: x.method || '',
      recipient: x.recipient || '',
      suggested_category: suggested === UNCATEGORIZED ? '' : suggested
    }
  };
}

function mergeExtraction_(body, tx) {
  return {
    amount: tx.amount,
    currency: tx.currency,
    merchant: tx.merchant,
    date: withBishkekOffset(tx.date),
    card: cleanText(body.card) || tx.bank,
    category: cleanText(body.category),
    suggested_category: tx.suggested_category,
    source: cleanText(body.source) || 'screenshot',
    kind: tx.kind,
    method: tx.method,
    recipient: tx.recipient
  };
}

/** "2026-09-28T16:38" → "2026-09-28T16:38:00+06:00"; невалидное → "" (тогда берётся текущее время). */
function withBishkekOffset(value) {
  var s = cleanText(value);
  var m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return '';
  var tz = s.match(/([zZ]|[+-]\d{2}:?\d{2})$/);
  return m[1] + 'T' + (m[2] || '12') + ':' + (m[3] || '00') + ':' + (m[4] || '00') + (tz ? tz[1] : '+06:00');
}

/** Определяет тип файла по первым байтам base64. */
function detectMediaType(base64) {
  var head = String(base64).slice(0, 12);
  if (head.indexOf('/9j/') === 0) return 'image/jpeg';
  if (head.indexOf('iVBOR') === 0) return 'image/png';
  if (head.indexOf('R0lGOD') === 0) return 'image/gif';
  if (head.indexOf('UklGR') === 0) return 'image/webp';
  if (head.indexOf('JVBER') === 0) return 'application/pdf';
  return 'image/jpeg';
}

function loadCategories_(ss) {
  var seen = {};
  var list = [];
  loadRules_(ss).forEach(function (r) {
    var c = cleanText(r[1]);
    if (c && !seen[c]) { seen[c] = true; list.push(c); }
  });
  [TRANSPORT, 'Переводы', 'Семья', 'Коммуналка', 'Одежда', 'Дом', 'Другое'].forEach(function (c) {
    if (!seen[c]) { seen[c] = true; list.push(c); }
  });
  return list;
}

/** Лист «Настройки»: колонка A — название, B — значение. */
function loadSettings_(ss) {
  var settings = { fareMax: DEFAULT_FARE_MAX };
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet || sheet.getLastRow() < 1) return settings;
  sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues().forEach(function (row) {
    var key = cleanText(row[0]).toLowerCase();
    if (key.indexOf('проезд') !== -1 && row[1] !== '' && !isNaN(Number(row[1]))) settings.fareMax = Number(row[1]);
  });
  return settings;
}

function stripToken_(body) {
  var copy = {};
  for (var k in body) if (k !== 'token' && k !== 'image') copy[k] = body[k];
  return copy;
}

/** Ошибка с полем message, чтобы её показало уведомление в Команде; видна и в «Выполнениях» Apps Script. */
function fail_(text) {
  console.error(text);
  return json_({ ok: false, error: text, message: '⚠️ ' + text });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function formatAmount_(n) {
  return (Math.round(n * 100) / 100).toString();
}

// ---------------------------------------------------------------------------
// Разбор данных (чистые функции — покрыты тестами в tests/)
// ---------------------------------------------------------------------------

var CURRENCY_ALIASES = {
  '$': 'USD', '€': 'EUR', '₽': 'RUB', '₸': 'KZT', 'сом': 'KGS', 'сомов': 'KGS', 'som': 'KGS'
};

/**
 * Разбирает сумму в любом виде, который присылают Команды/банки:
 *   160, "160", "KGS 160,00", "160,00 KGS", "3 141,1 KGS", "$12.50", "1,234.56 USD", "-374,00".
 * Возвращает { amount: число (положительное) | null, currency: 'KGS' | null }.
 */
function parseAmount(value) {
  if (typeof value === 'number') {
    return { amount: isFinite(value) ? Math.abs(value) : null, currency: null };
  }
  var s = cleanText(value);
  if (!s) return { amount: null, currency: null };

  var currency = null;
  var code = s.match(/\b([A-Z]{3})\b/);
  if (code) {
    currency = code[1];
  } else {
    var lower = s.toLowerCase();
    var aliases = Object.keys(CURRENCY_ALIASES).sort(function (a, b) { return b.length - a.length; });
    for (var i = 0; i < aliases.length; i++) {
      if (lower.indexOf(aliases[i]) !== -1) { currency = CURRENCY_ALIASES[aliases[i]]; break; }
    }
  }

  var num = s.replace(/[\s  ']/g, '').replace(/[^0-9.,]/g, '');
  if (!/[0-9]/.test(num)) return { amount: null, currency: currency };

  var lastComma = num.lastIndexOf(',');
  var lastDot = num.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Десятичный разделитель — тот, что стоит последним.
    if (lastComma > lastDot) num = num.replace(/\./g, '').replace(',', '.');
    else num = num.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // "1,234,567" — тысячи; "160,00" / "3141,1" — десятичная часть.
    if (/^\d{1,3}(,\d{3}){2,}$/.test(num)) num = num.replace(/,/g, '');
    else num = num.replace(/,(?=.*,)/g, '').replace(',', '.');
  } else if (lastDot !== -1 && /^\d{1,3}(\.\d{3}){2,}$/.test(num)) {
    num = num.replace(/\./g, '');
  }

  var amount = parseFloat(num);
  return { amount: isFinite(amount) ? Math.abs(amount) : null, currency: currency };
}

/** "Apteka Elbrus  Bishkek, Bishkek" → "Apteka Elbrus"; "MD00APTEKA ELBRUS, BISHKEK" → "APTEKA ELBRUS". */
function normalizeMerchant(value) {
  var s = cleanText(value);
  if (!s) return 'Неизвестно';
  s = s.replace(/^MD\d{2}(?=[A-Z])/, '');                 // префикс терминала MBank
  s = s.replace(/[\s,]+(Bishkek|Бишкек|Osh|Ош)([\s,]+(Bishkek|Бишкек|Osh|Ош))*\s*,?\s*(KG|KGZ)?$/i, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/[\s,]+$/, '');
  return s || 'Неизвестно';
}

/** Первое правило, чья подстрока встречается в названии магазина. */
function categorize(merchant, rules) {
  var m = String(merchant || '').toLowerCase();
  for (var i = 0; i < rules.length; i++) {
    var pattern = String(rules[i][0] || '').trim().toLowerCase();
    if (pattern && m.indexOf(pattern) !== -1) return String(rules[i][1]).trim() || UNCATEGORIZED;
  }
  return UNCATEGORIZED;
}

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[  ]/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Таблица
// ---------------------------------------------------------------------------

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function loadRules_(ss) {
  var sheet = ss.getSheetByName(SHEET_RULES);
  if (!sheet || sheet.getLastRow() < 2) return DEFAULT_RULES;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
}

/** Запусти один раз из редактора Apps Script. Повторный запуск безопасен. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    // Скрипт создан отдельно от таблицы (script.google.com) — берём ранее созданную или создаём новую.
    var savedId = props.getProperty('SPREADSHEET_ID');
    ss = savedId ? SpreadsheetApp.openById(savedId) : SpreadsheetApp.create('Расходы');
  }
  ss.setSpreadsheetTimeZone(TIMEZONE);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, ''));

  var tx = ss.getSheetByName(SHEET_TX) || ss.insertSheet(SHEET_TX, 0);
  if (tx.getLastRow() === 0) {
    tx.appendRow(TX_HEADERS);
    tx.setFrozenRows(1);
    tx.getRange('A:A').setNumberFormat('dd.mm.yyyy hh:mm');
    tx.getRange('B:B').setNumberFormat('#,##0.00');
    tx.getRange(1, 1, 1, TX_HEADERS.length).setFontWeight('bold');
  }

  var rules = ss.getSheetByName(SHEET_RULES) || ss.insertSheet(SHEET_RULES);
  if (rules.getLastRow() === 0) {
    rules.appendRow(['Если в названии магазина есть…', 'Категория']);
    rules.getRange(2, 1, DEFAULT_RULES.length, 2).setValues(DEFAULT_RULES);
    rules.setFrozenRows(1);
    rules.getRange('1:1').setFontWeight('bold');
  }

  var settings = ss.getSheetByName(SHEET_SETTINGS) || ss.insertSheet(SHEET_SETTINGS);
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, 3, 2).setValues([
      ['Максимальная цена проезда (QR-оплата человеку до этой суммы → «' + TRANSPORT + '»)', DEFAULT_FARE_MAX],
      ['', ''],
      ['Категория «' + EXCLUDED + '» не попадает в сводку: ставь её переводам себе и родным (через «Правила» по имени).', '']
    ]);
    settings.setColumnWidth(1, 520);
  }

  buildSummary_(ss);

  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  Logger.log('Готово. Таблица: ' + ss.getUrl());
  Logger.log('Токен для Команды на iPhone: ' + props.getProperty('TOKEN'));
}

function buildSummary_(ss) {
  var sheet = ss.getSheetByName(SHEET_SUMMARY);
  if (sheet) {
    sheet.getCharts().forEach(function (c) { sheet.removeChart(c); });
    sheet.clear();
  } else {
    sheet = ss.insertSheet(SHEET_SUMMARY, 0);
  }
  var tx = "'" + SHEET_TX + "'!A2:G";
  var monthStart = 'TEXT(EOMONTH(TODAY(),-1)+1,"yyyy-mm-dd")';

  sheet.getRange('A1').setValue('Этот месяц по категориям').setFontWeight('bold');
  sheet.getRange('A2').setFormula(
    '=IFERROR(QUERY(' + tx + ',"select E, sum(B) where A >= date \'"&' + monthStart +
    '&"\' and B is not null and E <> \'' + EXCLUDED + '\' group by E order by sum(B) desc label E \'Категория\', sum(B) \'Сумма\'",0),"Пока нет данных")');

  sheet.getRange('D1').setValue('Этот месяц: топ магазинов').setFontWeight('bold');
  sheet.getRange('D2').setFormula(
    '=IFERROR(QUERY(' + tx + ',"select D, count(B), sum(B) where A >= date \'"&' + monthStart +
    '&"\' and B is not null and E <> \'' + EXCLUDED + '\' group by D order by sum(B) desc limit 15 label D \'Магазин\', count(B) \'Раз\', sum(B) \'Сумма\'",0),"Пока нет данных")');

  sheet.getRange('H1').setValue('По месяцам').setFontWeight('bold');
  sheet.getRange('H2').setFormula(
    '=IFERROR(QUERY(' + tx + ',"select year(A), month(A)+1, sum(B) where B is not null and E <> \'' + EXCLUDED + '\' group by year(A), month(A)+1 ' +
    'order by year(A) desc, month(A)+1 desc label year(A) \'Год\', month(A)+1 \'Месяц\', sum(B) \'Сумма\'",0),"Пока нет данных")');

  sheet.getRange('L1').setValue('Всего за этот месяц').setFontWeight('bold');
  sheet.getRange('L2').setFormula('=SUMIFS(\'' + SHEET_TX + '\'!B2:B,\'' + SHEET_TX + '\'!A2:A,">="&(EOMONTH(TODAY(),-1)+1),\'' + SHEET_TX + '\'!E2:E,"<>' + EXCLUDED + '")');
  sheet.getRange('L2').setNumberFormat('#,##0.00');

  sheet.getRange('B:B').setNumberFormat('#,##0.00');
  sheet.getRange('F:F').setNumberFormat('#,##0.00');
  sheet.getRange('J:J').setNumberFormat('#,##0.00');

  var chart = sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange('A2:B20'))
    .setOption('title', 'Куда уходят деньги в этом месяце')
    .setOption('pieHole', 0.4)
    .setPosition(22, 1, 0, 0)
    .build();
  sheet.insertChart(chart);
}

/** Меню в таблице. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Расходы')
    .addItem('Пересчитать «' + UNCATEGORIZED + '» по правилам', 'recategorizeUncategorized')
    .addItem('Пересчитать ВСЕ категории по правилам', 'recategorizeAll')
    .addItem('Пересобрать сводку', 'rebuildSummary')
    .addItem('Показать токен', 'showToken')
    .addToUi();
}

function recategorizeUncategorized() { recategorize_(false); }
function recategorizeAll() { recategorize_(true); }
function rebuildSummary() { buildSummary_(getSpreadsheet_()); }

function showToken() {
  SpreadsheetApp.getUi().alert('Токен: ' + PropertiesService.getScriptProperties().getProperty('TOKEN'));
}

function recategorize_(all) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);
  var last = sheet.getLastRow();
  if (last < 2) return;
  var rules = loadRules_(ss);
  var range = sheet.getRange(2, 4, last - 1, 2);
  var values = range.getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    if (!all && values[i][1] && values[i][1] !== UNCATEGORIZED) continue;
    var cat = categorize(values[i][0], rules);
    if (cat !== values[i][1]) { values[i][1] = cat; changed++; }
  }
  range.setValues(values);
  ss.toast('Обновлено строк: ' + changed);
}

/**
 * Запусти из редактора, если команда пишет «нет разрешения на вызов UrlFetchApp.fetch»:
 * Google покажет окно доступа «Подключение к внешнему сервису» (нужно для Claude).
 */
function authorize() {
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '',
      'anthropic-version': '2023-06-01'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  Logger.log(code === 200
    ? 'Доступ в интернет есть, ключ Claude работает ✅'
    : code === 401
      ? 'Доступ в интернет есть, но ключ Claude неверный или не задан (401)'
      : 'Доступ в интернет есть, ответ Claude API: ' + code + ' ' + res.getContentText().slice(0, 200));
}
