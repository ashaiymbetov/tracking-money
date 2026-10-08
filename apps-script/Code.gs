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

var SCRIPT_VERSION = '2026-10-08-mbank';  // видно по GET-запросу на URL скрипта — так проверяем, что развёрнута свежая версия
var SHEET_TX = 'Транзакции';
var SHEET_RULES = 'Правила';
var SHEET_SUMMARY = 'Сводка';
var UNCATEGORIZED = 'Без категории';
var EXCLUDED = 'Не учитывать';        // строка остаётся в таблице, но не попадает в сводку
var TRANSPORT = 'Транспорт';
var SHEET_SETTINGS = 'Настройки';
var SHEET_BUDGETS = 'Бюджеты';
var SHEET_LOGOS = 'Логотипы';
var API_MONTHS = 13;                  // сколько месяцев истории отдаёт API приложению
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
    if ((body.text !== undefined && body.amount === undefined) || body.image) {
      if (body.text !== undefined && !body.image && cleanText(body.text).length < 3) {
        return fail_('iPhone не нашёл текста на скрине — открой чек и попробуй ещё раз');
      }
      var ss = getSpreadsheet_();
      var ai = body.image
        ? extractFromImage_(body.image, body.mime, loadCategories_(ss))
        : extractFromText_(body.text, loadCategories_(ss));
      var aiInput = body.image ? 'image' : 'text';
      var items = extractedItems_(ai.data);
      if (items.length > 1) {
        // Скрин истории операций: дальше, под блокировкой, запишем только те, которых ещё нет в таблице.
        body = { action: 'extractedList', items: items, card: body.card, source: body.source, ai_input: aiInput, ai_tokens: ai.usage };
      } else {
        var decision = interpretExtraction(items[0], loadSettings_(ss).fareMax);
        if (!decision.record) return json_({ ok: true, skipped: true, message: decision.message });
        body = mergeExtraction_(body, decision.tx);
        body.ai_input = aiInput;          // что ушло в Claude — картинка или текст
        body.ai_tokens = ai.usage;        // реальный расход: { in, out } токенов — видно в «Исходных данных»
      }
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var result = body.action === 'setCategory' ? setCategory_(body)
        : body.action === 'setBudget' ? setBudget_(body)
        : body.action === 'import' ? importRows_(body)
        : body.action === 'extractedList' ? importExtracted_(body)
        : body.action === 'setLogo' ? setLogo_(body)
        : body.action === 'findLogos' ? findLogos_(body)
        : body.action === 'categorizeUnknown' ? categorizeUnknown_()
        : addTransaction_(body);
      // Сразу пересобираем кэш для приложения: открыл его после покупки — данные уже готовы.
      if (result && result.ok && !result.skipped && !result.duplicate) refreshDataCache_();
      return json_(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return fail_(String(err && err.message || err));
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'data') {
    if (p.token !== PropertiesService.getScriptProperties().getProperty('TOKEN')) return fail_('неверный токен');
    try {
      var started = Date.now();
      var cached = readDataCache_();
      if (cached) return textJson_(cached.replace(/^\{/, '{"cached":true,"serverMs":' + (Date.now() - started) + ','));
      var fresh = JSON.stringify(buildData_(getSpreadsheet_()));
      writeDataCache_(fresh);
      return textJson_(fresh.replace(/^\{/, '{"cached":false,"serverMs":' + (Date.now() - started) + ','));
    } catch (err) {
      return fail_(String(err && err.message || err));
    }
  }
  return json_({ ok: true, version: SCRIPT_VERSION, message: 'Трекер расходов работает (версия ' + SCRIPT_VERSION + '). Используй POST.' });
}

// ---------------------------------------------------------------------------
// API для приложения
// ---------------------------------------------------------------------------

// Кэш готового ответа doGet?action=data. Сжат (gzip + base64) и порезан на куски: у CacheService лимит 100 КБ на ключ.
var DATA_CACHE_KEY = 'data:v1';
var DATA_CACHE_TTL = 25 * 60;          // сек; обновляется после каждой записи и по расписанию раз в 10 минут
var DATA_CACHE_CHUNK = 90000;

function writeDataCache_(json) {
  try {
    var packed = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes());
    var parts = {};
    var n = Math.ceil(packed.length / DATA_CACHE_CHUNK);
    if (n > 20) return;                                   // слишком большой ответ — просто без кэша
    for (var i = 0; i < n; i++) parts[DATA_CACHE_KEY + ':' + i] = packed.slice(i * DATA_CACHE_CHUNK, (i + 1) * DATA_CACHE_CHUNK);
    parts[DATA_CACHE_KEY] = String(n);
    CacheService.getScriptCache().putAll(parts, DATA_CACHE_TTL);
  } catch (err) {
    console.warn('кэш не записан: ' + err);
  }
}

function readDataCache_() {
  try {
    var cache = CacheService.getScriptCache();
    var n = Number(cache.get(DATA_CACHE_KEY));
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(DATA_CACHE_KEY + ':' + i);
    var got = cache.getAll(keys);
    var packed = '';
    for (var j = 0; j < n; j++) {
      if (!got[keys[j]]) return null;                     // кусок вытеснен — пересоберём
      packed += got[keys[j]];
    }
    return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(packed), 'application/x-gzip')).getDataAsString();
  } catch (err) {
    return null;
  }
}

/** Пересобрать кэш сейчас. Вызывается после записей и триггером по расписанию (см. setup). */
function refreshDataCache_() {
  try {
    writeDataCache_(JSON.stringify(buildData_(getSpreadsheet_())));
  } catch (err) {
    console.warn('кэш не обновлён: ' + err);
  }
}

/** Для триггера по расписанию: подхватывает ручные правки в таблице и держит скрипт «тёплым». */
function refreshCache() { refreshDataCache_(); }

function textJson_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

/** Все операции за последние API_MONTHS месяцев + справочники. */
function buildData_(ss) {
  var sheet = ss.getSheetByName(SHEET_TX);
  var now = new Date();
  var from = new Date(now.getFullYear(), now.getMonth() - (API_MONTHS - 1), 1);
  var tx = [];
  var last = sheet.getLastRow();
  if (last >= 2) {
    var values = sheet.getRange(2, 1, last - 1, 7).getValues();
    for (var i = 0; i < values.length; i++) {
      var r = values[i];
      if (!isDate_(r[0]) || r[0] < from || r[1] === '' || isNaN(Number(r[1]))) continue;
      tx.push({
        id: i + 2,
        date: r[0].toISOString(),
        amount: Number(r[1]),
        currency: String(r[2] || DEFAULT_CURRENCY),
        merchant: String(r[3] || ''),
        category: String(r[4] || UNCATEGORIZED),
        card: String(r[5] || ''),
        source: String(r[6] || '')
      });
    }
  }
  var categories = loadCategories_(ss);
  tx.forEach(function (t) { if (categories.indexOf(t.category) === -1) categories.push(t.category); });
  [UNCATEGORIZED, EXCLUDED].forEach(function (c) { if (categories.indexOf(c) === -1) categories.push(c); });

  return {
    ok: true,
    generatedAt: now.toISOString(),
    currency: DEFAULT_CURRENCY,
    excludedCategory: EXCLUDED,
    uncategorized: UNCATEGORIZED,
    categories: categories,
    budgets: loadBudgets_(ss),
    logos: loadLogos_(ss),
    settings: loadSettings_(ss),
    transactions: tx
  };
}

function loadBudgets_(ss) {
  var sheet = ss.getSheetByName(SHEET_BUDGETS);
  var budgets = {};
  if (!sheet || sheet.getLastRow() < 2) return budgets;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var c = cleanText(r[0]);
    if (c && Number(r[1]) > 0) budgets[c] = Number(r[1]);
  });
  return budgets;
}

/** Смена категории операции; remember=true — ещё и правило «магазин → категория» (встаёт первым). */
function setCategory_(body) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);
  var row = Number(body.id);
  var category = cleanText(body.category);
  if (!category) return { ok: false, error: 'не указана категория', message: '⚠️ Не указана категория' };
  if (!(row >= 2 && row <= sheet.getLastRow())) return { ok: false, error: 'строка не найдена', message: '⚠️ Операция не найдена' };
  var merchant = String(sheet.getRange(row, 4).getValue());
  if (body.merchant !== undefined && cleanText(body.merchant) !== cleanText(merchant)) {
    return { ok: false, error: 'таблица изменилась', message: '⚠️ Таблица изменилась, обнови данные' };
  }
  sheet.getRange(row, 5).setValue(category);

  if (body.remember && cleanText(merchant)) {
    var rules = ss.getSheetByName(SHEET_RULES);
    rules.insertRowBefore(2);
    rules.getRange(2, 1, 1, 2).setValues([[cleanText(merchant).toLowerCase(), category]]);
    recategorize_(false);
  }
  return { ok: true, message: merchant + ' → ' + category };
}

var IMPORT_DUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * Импорт операций из выписки (приложение разбирает PDF на телефоне и присылает готовые строки).
 * Дубли с уже записанными (Apple Pay, скрины, прошлый импорт) — та же сумма в пределах 15 минут;
 * каждая записанная строка «гасит» не больше одной импортируемой, чтобы две одинаковые покупки подряд не пропали.
 */
function importRows_(body) {
  var rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
  if (!rows.length) return { ok: false, error: 'нет строк', message: '⚠️ В выписке не нашлось операций' };
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);
  var rules = loadRules_(ss);
  var fareMax = loadSettings_(ss).fareMax;

  var existing = existingByAmount_(sheet);

  var out = [];
  var duplicates = 0;
  var uncategorized = 0;
  rows.forEach(function (r) {
    var amount = Math.abs(Number(r.amount));
    var date = new Date(r.date);
    if (!(amount > 0) || isNaN(date.getTime())) return;
    if (takeDuplicate_(existing, amount, date, false)) { duplicates++; return; }
    var merchant = normalizeMerchant(r.merchant);
    var category = cleanText(r.category) || categorize(merchant, rules);
    if (category === UNCATEGORIZED && isFare('payment', r.recipient || '', amount, fareMax)) category = TRANSPORT;
    // Перевод человеку, которого нет в правилах (родных можно отправить в «Не учитывать» правилом).
    if (category === UNCATEGORIZED && r.recipient === 'person') category = 'Переводы';
    if (category === UNCATEGORIZED) uncategorized++;
    out.push([date, amount, DEFAULT_CURRENCY, merchant, category, cleanText(body.card), 'statement',
      JSON.stringify({ bank: cleanText(body.bank), method: r.method || '', recipient: r.recipient || '' })]);
  });
  out.sort(function (a, b) { return a[0] - b[0]; });
  if (out.length) sheet.getRange(sheet.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  return {
    ok: true, added: out.length, duplicates: duplicates, uncategorized: uncategorized,
    message: 'Добавлено ' + out.length + ', уже было ' + duplicates + (uncategorized ? ', без категории ' + uncategorized : '')
  };
}

/** Все записанные операции: сумма → список времён (мс). */
function existingByAmount_(sheet) {
  var existing = {};
  var last = sheet.getLastRow();
  if (last < 2) return existing;
  sheet.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    if (!isDate_(r[0]) || isNaN(Number(r[1]))) return;
    var key = Number(r[1]).toFixed(2);
    (existing[key] = existing[key] || []).push(r[0].getTime());
  });
  return existing;
}

/** Бишкек круглый год UTC+6 — день считаем без календарных библиотек. */
function bishkekDay_(ms) {
  return new Date(ms + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Есть ли уже такая операция: та же сумма в пределах 15 минут, а если известен только день — в тот же день.
 * Найденная запись «гасится», чтобы две одинаковые покупки (например, два проезда) не слились в одну.
 */
function takeDuplicate_(existing, amount, date, dayOnly) {
  var times = existing[Number(amount).toFixed(2)];
  if (!times) return false;
  for (var i = 0; i < times.length; i++) {
    var same = dayOnly ? bishkekDay_(times[i]) === bishkekDay_(date.getTime())
      : Math.abs(times[i] - date.getTime()) <= IMPORT_DUP_WINDOW_MS;
    if (same) { times.splice(i, 1); return true; }
  }
  return false;
}

/**
 * Скрин истории операций (MBank, O!Bank…) → записываем только пропущенные: те, что не поймал Apple Pay
 * или не отправили скрином. Поступления и переводы себе пропускаются, как и для одиночного чека.
 */
function importExtracted_(body) {
  var items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);
  var rules = loadRules_(ss);
  var fareMax = loadSettings_(ss).fareMax;
  var existing = existingByAmount_(sheet);

  var out = [];
  var total = 0;
  var duplicates = 0;
  var skipped = 0;
  items.forEach(function (x) {
    var d = interpretExtraction(x, fareMax);
    if (!d.record) { skipped++; return; }
    var tx = d.tx;
    var iso = withBishkekOffset(tx.date);
    var dayOnly = !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(tx.date);
    var date = iso ? new Date(iso) : new Date();
    if (takeDuplicate_(existing, tx.amount, date, dayOnly)) { duplicates++; return; }
    var merchant = normalizeMerchant(tx.merchant);
    var category = categorize(merchant, rules);
    if (category === UNCATEGORIZED && tx.suggested_category) category = tx.suggested_category;
    var raw = { from: 'list', kind: tx.kind, method: tx.method, recipient: tx.recipient, bank: tx.bank, ai_input: body.ai_input };
    if (!out.length && body.ai_tokens) raw.ai_tokens = body.ai_tokens;   // токены — за весь скрин, пишем один раз
    out.push([date, tx.amount, tx.currency, merchant, category, cleanText(body.card) || tx.bank, cleanText(body.source) || 'screenshot', JSON.stringify(raw)]);
    if (tx.currency === DEFAULT_CURRENCY) total += tx.amount;
  });
  out.sort(function (a, b) { return a[0] - b[0]; });
  if (out.length) sheet.getRange(sheet.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);

  var tail = (duplicates ? ', уже было ' + duplicates : '') + (skipped ? ', пропущено ' + skipped + ' (поступления и т. п.)' : '');
  if (!out.length) return { ok: true, skipped: true, added: 0, duplicates: duplicates, message: '✓ Всё уже записано' + tail };
  return {
    ok: true, added: out.length, duplicates: duplicates,
    message: 'Дописал ' + out.length + ' на ' + formatAmount_(total) + ' ' + DEFAULT_CURRENCY + tail
  };
}

/**
 * Разовый разбор «Без категории» через Claude: один запрос на все уникальные названия (≈ 3 цента за ~80 мест).
 * Ответ запоминается правилами — дальше эти места определяются бесплатно.
 */
function categorizeUnknown_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);
  var last = sheet.getLastRow();
  if (last < 2) return { ok: true, updated: 0, message: 'Нечего разбирать' };
  var range = sheet.getRange(2, 4, last - 1, 2);
  var values = range.getValues();
  var seen = {};
  var merchants = [];
  values.forEach(function (r) {
    var m = cleanText(r[0]);
    if (m && r[1] === UNCATEGORIZED && !seen[m.toLowerCase()] && merchants.length < 150) { seen[m.toLowerCase()] = true; merchants.push(m); }
  });
  if (!merchants.length) return { ok: true, updated: 0, message: 'Все операции уже с категориями' };

  var categories = loadCategories_(ss).filter(function (c) { return c !== EXCLUDED; });
  var schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { merchant: { type: 'string' }, category: { type: 'string', enum: categories } },
          required: ['merchant', 'category'],
          additionalProperties: false
        }
      }
    },
    required: ['items'],
    additionalProperties: false
  };
  var prompt = [
    'Assign a spending category to each merchant from a Kyrgyz (Bishkek) bank statement.',
    'Private persons («Айбек К.», full names) → «Переводы». Supermarkets/grocery chains (Globus/Глобус, Азия, Достор, Народный, Фрунзе) → «Продукты».',
    'Cafés, canteens, pizza, coffee, Shoro kiosks → «Кафе и еда». Scooter/bike rentals and buses → «Транспорт». Taxi → «Такси».',
    '«Коммуналка» = electricity, water, gas, heating, housing fees; «Связь» = mobile/internet. If unsure → «' + UNCATEGORIZED + '».',
    'Return every merchant exactly as given.',
    '',
    merchants.map(function (m, i) { return (i + 1) + '. ' + m; }).join('\n')
  ].join('\n');

  var ai = callClaudeWith_([{ type: 'text', text: prompt }], schema, 8000);
  var map = {};
  (ai.data.items || []).forEach(function (it) {
    if (it && it.merchant && it.category && it.category !== UNCATEGORIZED) map[cleanText(it.merchant).toLowerCase()] = it.category;
  });

  var updated = 0;
  values.forEach(function (r) {
    var c = map[cleanText(r[0]).toLowerCase()];
    if (r[1] === UNCATEGORIZED && c) { r[1] = c; updated++; }
  });
  range.setValues(values);

  // Запоминаем правилами (новые — сверху, чтобы были главнее общих).
  var newRules = Object.keys(map).map(function (m) { return [m, map[m]]; });
  if (newRules.length) {
    var rulesSheet = ss.getSheetByName(SHEET_RULES);
    rulesSheet.insertRowsBefore(2, newRules.length);
    rulesSheet.getRange(2, 1, newRules.length, 2).setValues(newRules);
  }
  return {
    ok: true, updated: updated, rules: newRules.length, tokens: ai.usage,
    message: 'Разобрано ' + updated + ' операций, запомнено ' + newRules.length + ' мест'
  };
}

/** Лист «Логотипы»: «если в названии есть…» → сайт (globus.kg) или ссылка на картинку. */
function loadLogos_(ss) {
  var sheet = ss.getSheetByName(SHEET_LOGOS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
    .map(function (r) { return [cleanText(r[0]).toLowerCase(), cleanText(r[1])]; })
    .filter(function (r) { return r[0] && r[1]; });
}

/** «Сайт магазина» из приложения: globus.kg, https://globus.kg/ru → globus.kg; ссылку на картинку храним как есть. */
function normalizeLogoSource(value) {
  var v = cleanText(value);
  if (!v) return '';
  if (/^https?:\/\/.+\.(png|jpe?g|svg|webp|gif|ico)(\?.*)?$/i.test(v)) return v;
  return v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[\/?#].*$/, '').toLowerCase();
}

function setLogo_(body) {
  var ss = getSpreadsheet_();
  var pattern = cleanText(body.merchant).toLowerCase();
  if (!pattern) return { ok: false, error: 'нет названия', message: '⚠️ Нет названия магазина' };
  var source = normalizeLogoSource(body.site);
  var sheet = ss.getSheetByName(SHEET_LOGOS) || ss.insertSheet(SHEET_LOGOS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Если в названии есть…', 'Сайт или ссылка на картинку']);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  var last = sheet.getLastRow();
  var names = last >= 2 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return cleanText(r[0]).toLowerCase(); }) : [];
  var idx = names.indexOf(pattern);
  if (idx !== -1 && !source) sheet.deleteRow(idx + 2);
  else if (idx !== -1) sheet.getRange(idx + 2, 2).setValue(source);
  else if (source) sheet.appendRow([pattern, source]);
  return { ok: true, logos: loadLogos_(ss), message: source ? 'Логотип сохранён' : 'Логотип убран' };
}

var LOGO_BATCH = 25;          // мест за один запуск
var LOGO_MAX_SEARCHES = 10;   // веб-поисков на запуск — ограничивает цену (≈ до 40 центов)

/**
 * «Найти логотипы»: Claude определяет официальный сайт для мест без логотипа (известные бренды — по знанию,
 * местные — веб-поиском) и сохраняет их на лист «Логотипы». Дальше иконки грузятся с сайтов бесплатно.
 */
function findLogos_(body) {
  var merchants = (Array.isArray(body.merchants) ? body.merchants : [])
    .map(cleanText).filter(Boolean).slice(0, LOGO_BATCH);
  if (!merchants.length) return { ok: true, found: 0, message: 'Все места уже с логотипами' };

  var prompt = [
    'These are merchant names from Kyrgyz bank statements (Bishkek). For each, find the official website domain of the brand or business.',
    'Rules: use your own knowledge for well-known brands (prefer the Kyrgyz site if it exists, e.g. a .kg domain, otherwise the global one).',
    'Use web search only for local businesses you are not sure about, at most ' + LOGO_MAX_SEARCHES + ' searches in total.',
    'Names may be transliterated or truncated (e.g. "Imperiya Pitstsy Oshskiy" = «Империя пиццы»). Ignore branch numbers and addresses.',
    'If there is no official site, or you are not sure it is the same business, use null — a wrong logo is worse than none.',
    'keyword: a short lowercase part of the given name that identifies the brand (e.g. "intersport", "imperiya pitstsy").',
    'Answer with ONLY a JSON object, no prose: {"items":[{"merchant":"<as given>","keyword":"<lowercase>","domain":"example.kg" or null}]}',
    '',
    merchants.map(function (m, i) { return (i + 1) + '. ' + m; }).join('\n')
  ].join('\n');

  var tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: LOGO_MAX_SEARCHES }];
  var reply = callClaudeLoop_([{ role: 'user', content: prompt }], tools, 8000);
  var parsed = extractJsonObject(reply.text);
  var items = parsed && Array.isArray(parsed.items) ? parsed.items : [];

  var ss = getSpreadsheet_();
  var found = 0;
  items.forEach(function (it) {
    var domain = normalizeLogoSource(it && it.domain);
    var merchant = cleanText(it && it.merchant).toLowerCase();
    if (!merchant || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return;
    var keyword = cleanText(it.keyword).toLowerCase();
    var pattern = keyword.length >= 3 && merchant.indexOf(keyword) !== -1 ? keyword : merchant;
    setLogo_({ merchant: pattern, site: domain });
    found++;
  });
  return {
    ok: true, found: found, checked: merchants.length, tokens: reply.usage, searches: reply.searches,
    logos: loadLogos_(ss),
    message: 'Найдено логотипов: ' + found + ' из ' + merchants.length
  };
}

/** Первый JSON-объект в тексте ответа (Claude с веб-поиском отвечает текстом, а не structured output). */
function extractJsonObject(text) {
  var s = String(text || '');
  var start = s.indexOf('{');
  while (start !== -1) {
    var depth = 0;
    for (var i = start; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}' && --depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { break; }
      }
    }
    start = s.indexOf('{', start + 1);
  }
  return null;
}

/**
 * Запрос к Claude с серверными инструментами (веб-поиск). Если сервер прервал ход (pause_turn),
 * дослаем ответ ассистента и продолжаем — не больше 4 раз.
 */
function callClaudeLoop_(messages, tools, maxTokens) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Не задан ANTHROPIC_API_KEY в свойствах скрипта');
  var usage = { in: 0, out: 0 };
  var searches = 0;
  var text = '';
  for (var round = 0; round < 5; round++) {
    var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      payload: JSON.stringify({
        model: CLAUDE_MODEL, max_tokens: maxTokens, fallbacks: 'default',
        output_config: { effort: 'low' }, tools: tools, messages: messages
      }),
      muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) {
      throw new Error('Claude API ' + res.getResponseCode() + ': ' + (body.error && body.error.message || res.getContentText()));
    }
    if (body.usage) {
      usage.in += body.usage.input_tokens || 0;
      usage.out += body.usage.output_tokens || 0;
      searches += (body.usage.server_tool_use && body.usage.server_tool_use.web_search_requests) || 0;
    }
    (body.content || []).forEach(function (b) { if (b.type === 'text') text += b.text; });
    if (body.stop_reason === 'refusal') throw new Error('Claude отказался выполнять запрос');
    if (body.stop_reason !== 'pause_turn') break;
    messages = messages.concat([{ role: 'assistant', content: body.content }]);
  }
  return { text: text, usage: usage, searches: searches };
}

/** Лимит на категорию в месяц; limit 0 — убрать. */
function setBudget_(body) {
  var ss = getSpreadsheet_();
  var category = cleanText(body.category);
  var limit = Number(body.limit);
  if (!category || isNaN(limit) || limit < 0) return { ok: false, error: 'неверный бюджет', message: '⚠️ Неверный бюджет' };
  var sheet = ss.getSheetByName(SHEET_BUDGETS) || ss.insertSheet(SHEET_BUDGETS);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Категория', 'Лимит в месяц']);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  var last = sheet.getLastRow();
  var names = last >= 2 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return cleanText(r[0]); }) : [];
  var idx = names.indexOf(category);
  if (idx !== -1 && limit === 0) sheet.deleteRow(idx + 2);
  else if (idx !== -1) sheet.getRange(idx + 2, 2).setValue(limit);
  else if (limit > 0) sheet.appendRow([category, limit]);
  return { ok: true, budgets: loadBudgets_(ss) };
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
    if (!isDate_(d)) continue;
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

var TX_ITEM_SCHEMA = {
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

/** Чек — одна операция; скрин истории в банке — несколько (тогда записываем только те, которых ещё нет). */
var EXTRACTION_SCHEMA = {
  type: 'object',
  properties: { transactions: { type: 'array', items: TX_ITEM_SCHEMA } },
  required: ['transactions'],
  additionalProperties: false
};

/** Ответ Claude → список операций (старый формат с одной операцией тоже понимаем). */
function extractedItems_(data) {
  if (data && Array.isArray(data.transactions)) return data.transactions;
  return data && data.kind ? [data] : [];
}

/**
 * Инструкция для Claude. На английском — так она занимает в несколько раз меньше токенов, чем на русском;
 * значения (магазин, категория) Claude возвращает как в чеке и из списка категорий.
 */
function extractionPrompt_(categories, source) {
  return [
    'Extract the transactions from this ' + (source === 'text'
      ? 'text, read by OCR from a screenshot of a Kyrgyz banking app (MBank, O!Bank/O!Dengi, Simbank…). OCR may break lines, misread symbols or split a list row into columns.'
      : 'screenshot/receipt of a Kyrgyz banking app (MBank, O!Bank/O!Dengi, Simbank…).'),
    'A receipt or a single operation = ONE item. A history/list of operations = one item per row, every completed row visible (also income — mark its kind); skip rows cut off so the amount is not visible. Nothing found = empty array.',
    'In lists «-540 с» is money spent, «+540 с» is received.',
    'kind: payment (purchase/service, incl. QR) | transfer_out (to another person) | income | transfer_in | own_transfer (between own accounts) | not_a_transaction (no completed operation: error, balance, ad).',
    'method: qr (QR/ELQR mentioned) | phone_transfer (by phone or card number) | card | other.',
    'recipient: business (shop, company, named ИП) | person (private individual, e.g. «Алтынбек А.») | self | unknown.',
    'amount: positive number, without a separately listed fee; 0 if none. currency: ISO code, «сом»/«с» = KGS.',
    'merchant: the actual shop/ИП/service or person that received the money — usually under «Purpose of the payment»/«Назначение платежа»/«Получатель». ' +
      'NEVER use payment processors or stamps: O!Dengi, O!Деньги, Green Telecom Service, XPAY, ELQR, MBank, Simbank, Visa, «PAID». ' +
      'Write it as in the receipt without service prefixes (MPEmgekLyuks → Emgek Lyuks, MD00APTEKA → APTEKA), no phone/account numbers.',
    'date: YYYY-MM-DDTHH:MM (Bishkek time); YYYY-MM-DD if only the day is shown (list section headers like «Сегодня», «Вчера», «5 октября» give the day of the rows below); "" if not shown. ' +
      'Today in Bishkek is ' + bishkekDay_(Date.now()) + '. bank: bank/app name or "".',
    'category: one of [' + categories.join(', ') + '], else «' + UNCATEGORIZED + '». Choose by what the merchant sells, not by the payment processor. ' +
      '«Коммуналка» = electricity, water, gas, heating, garbage, housing fees; «Дом» = goods for the home; «Связь» = mobile/internet top-ups only.'
  ].join('\n');
}

/** Отправляет содержимое в Claude; возвращает { data: объект по EXTRACTION_SCHEMA, usage: токены }. */
function callClaude_(content) {
  return callClaudeWith_(content, EXTRACTION_SCHEMA, 4000);
}

function callClaudeWith_(content, schema, maxTokens) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Не задан ANTHROPIC_API_KEY в свойствах скрипта');

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
    messages: [{ role: 'user', content: content }]
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
  if (body.stop_reason === 'refusal') throw new Error('Claude отказался обрабатывать чек');
  if (body.stop_reason === 'max_tokens') throw new Error('Ответ Claude обрезан (max_tokens)');

  var usage = body.usage ? { in: body.usage.input_tokens, out: body.usage.output_tokens } : null;
  for (var i = 0; i < body.content.length; i++) {
    if (body.content[i].type === 'text') return { data: JSON.parse(body.content[i].text), usage: usage };
  }
  throw new Error('Claude не вернул текстовый ответ');
}

/** Картинка (или PDF) чека → Claude. Дороже: картинка ≈ 1 500 токенов. */
function extractFromImage_(base64, mime, categories) {
  var data = String(base64).replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  var mediaType = cleanText(mime) || detectMediaType(data);
  var fileBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: data } };
  return callClaude_([fileBlock, { type: 'text', text: extractionPrompt_(categories, 'image') }]);
}

/**
 * Текст чека (iPhone распознаёт его сам — действие «Извлечь текст из изображения», бесплатно) → Claude.
 * В 5–10 раз дешевле картинки.
 */
function extractFromText_(text, categories) {
  var receipt = cleanText(text).slice(0, 4000);
  return callClaude_([{ type: 'text', text: extractionPrompt_(categories, 'text') + '\n\n<receipt>\n' + receipt + '\n</receipt>' }]);
}

/**
 * Проезд в маршрутке: небольшая оплата или перевод частному лицу (водителю).
 * В Бишкеке это часто выглядит как обычный перевод на номер, без слова «QR», поэтому способ оплаты не учитываем.
 * recipient пустой — строки, записанные до появления этого поля.
 */
function isFare(kind, recipient, amount, fareMax) {
  if (kind !== 'transfer_out' && kind !== 'payment') return false;
  if (recipient === 'business' || recipient === 'self') return false;
  if (kind === 'payment' && recipient !== 'person') return false;
  return Number(amount) > 0 && Number(amount) <= Number(fareMax);
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
  if (isFare(x.kind, x.recipient, amount, fareMax)) suggested = TRANSPORT;
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
  [TRANSPORT, 'Переводы', 'Семья', 'Коммуналка', 'Одежда', 'Дом', 'Кредит и комиссии', 'Другое'].forEach(function (c) {
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

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function stripToken_(body) {
  var copy = {};
  for (var k in body) if (k !== 'token' && k !== 'image' && k !== 'text') copy[k] = body[k];
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
  // Префикс мерчанта XPAY/O!Деньги, слова слиты: MPEmgekLyuks → Emgek Lyuks (YouTube, PayPal и т. п. не трогаем).
  if (/^MP[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(s)) s = s.slice(2).replace(/([a-z])([A-Z])/g, '$1 $2');
  else s = s.replace(/^MP(?=[A-Z][a-z])/, '');
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

  // Раз в 10 минут освежаем кэш для приложения (переустанавливаем, чтобы не плодить дубли триггеров).
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshCache').timeBased().everyMinutes(10).create();
  refreshDataCache_();

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
    .addItem('Разнести мелкие переводы людям в «' + TRANSPORT + '»', 'applyFareRule')
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
  try { ss.toast('Обновлено строк: ' + changed); } catch (ignored) {}
}

/**
 * Для уже записанных строк со скринов: перевод частному лицу до порога проезда → «Транспорт».
 * Не трогает строки, чьё имя есть в «Правилах», и строки, где категорию ставили вручную на что-то кроме «Переводы».
 */
function applyFareRule() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_TX);
  var last = sheet.getLastRow();
  if (last < 2) return;
  var rules = loadRules_(ss);
  var fareMax = loadSettings_(ss).fareMax;
  var range = sheet.getRange(2, 1, last - 1, TX_HEADERS.length);
  var values = range.getValues();
  var changed = 0;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var current = String(row[4]);
    if (current !== 'Переводы' && current !== UNCATEGORIZED) continue;
    if (categorize(row[3], rules) !== UNCATEGORIZED) continue;
    var raw = {};
    try { raw = JSON.parse(row[7] || '{}'); } catch (ignored) {}
    if (!isFare(raw.kind, raw.recipient || '', row[1], fareMax)) continue;
    sheet.getRange(i + 2, 5).setValue(TRANSPORT);
    changed++;
  }
  ss.toast('Перенесено в «' + TRANSPORT + '»: ' + changed);
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
