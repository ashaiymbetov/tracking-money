const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatMoney(value: number, currency = 'KGS', precise = false): string {
  const n = (precise ? money2 : money).format(value);
  return currency === 'KGS' ? `${n} с` : `${n} ${currency}`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} млн`;
  if (value >= 10_000) return `${Math.round(value / 1000)}к`;
  return money.format(value);
}

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const monthShort = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const monthGen = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const monthName = (m: number) => monthNames[m];
export const monthShortName = (m: number) => monthShort[m];

export function formatDayHeader(d: Date, today = new Date()): string {
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key(d) === key(today)) return 'Сегодня';
  if (key(d) === key(yesterday)) return 'Вчера';
  const weekday = d.toLocaleDateString('ru-RU', { weekday: 'long' });
  return `${d.getDate()} ${monthGen[d.getMonth()]}, ${weekday}`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function pluralOps(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} операция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} операции`;
  return `${n} операций`;
}

export function pluralNew(n: number): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `+${n} новая операция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `+${n} новые операции`;
  return `+${n} новых операций`;
}

/** «только что», «2 мин назад», «в 14:05» */
export function formatUpdated(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  return `в ${new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
