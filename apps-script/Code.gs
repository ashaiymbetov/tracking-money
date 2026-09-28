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
      return json_({ ok: false, error: 'bad token' });
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
    return json_({ ok: false, error: String(err) });
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
    return { ok: false, error: 'не удалось распознать сумму: ' + body.amount };
  }
  var currency = cleanText(body.currency) || parsed.currency || DEFAULT_CURRENCY;
  var merchant = normalizeMerchant(body.merchant);
  var card = cleanText(body.card);
  var source = cleanText(body.source) || 'apple-pay';
  var date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime())) date = new Date();

  var category = cleanText(body.category) || categorize(merchant, loadRules_(ss));

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

function stripToken_(body) {
  var copy = {};
  for (var k in body) if (k !== 'token') copy[k] = body[k];
  return copy;
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TIMEZONE);
  var props = PropertiesService.getScriptProperties();
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

  buildSummary_(ss);

  var sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('Лист1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet1);

  Logger.log('Готово. Токен для Команды на iPhone: ' + props.getProperty('TOKEN'));
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
    '&"\' and B is not null group by E order by sum(B) desc label E \'Категория\', sum(B) \'Сумма\'",0),"Пока нет данных")');

  sheet.getRange('D1').setValue('Этот месяц: топ магазинов').setFontWeight('bold');
  sheet.getRange('D2').setFormula(
    '=IFERROR(QUERY(' + tx + ',"select D, count(B), sum(B) where A >= date \'"&' + monthStart +
    '&"\' and B is not null group by D order by sum(B) desc limit 15 label D \'Магазин\', count(B) \'Раз\', sum(B) \'Сумма\'",0),"Пока нет данных")');

  sheet.getRange('H1').setValue('По месяцам').setFontWeight('bold');
  sheet.getRange('H2').setFormula(
    '=IFERROR(QUERY(' + tx + ',"select year(A), month(A)+1, sum(B) where B is not null group by year(A), month(A)+1 ' +
    'order by year(A) desc, month(A)+1 desc label year(A) \'Год\', month(A)+1 \'Месяц\', sum(B) \'Сумма\'",0),"Пока нет данных")');

  sheet.getRange('L1').setValue('Всего за этот месяц').setFontWeight('bold');
  sheet.getRange('L2').setFormula('=SUMIFS(\'' + SHEET_TX + '\'!B2:B,\'' + SHEET_TX + '\'!A2:A,">="&(EOMONTH(TODAY(),-1)+1))');
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
  SpreadsheetApp.getActive().toast('Обновлено строк: ' + changed);
}
