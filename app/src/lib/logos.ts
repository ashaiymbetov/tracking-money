/**
 * Логотипы мест: «если в названии есть…» → сайт. Иконку берём с сайта (favicon) через сервисы иконок;
 * не загрузилась или пришла пустая заглушка — показываем иконку категории.
 */

// Только места, в сайте которых уверены. Остальное — лист «Логотипы» (вручную или кнопкой «Найти логотипы»).
export const DEFAULT_LOGOS: [string, string][] = [
  ['globus', 'globus.kg'], ['глобус', 'globus.kg'],
  ['азия', 'asia.kg'], ['asia', 'asia.kg'],
  ['tulpar', 'tulpar-card.kg'], ['тулпар', 'tulpar-card.kg'],
  ['yandex', 'yandex.com'],
  ['glovo', 'glovoapp.com'],
  ['wildberries', 'wildberries.ru'],
  ['ozon', 'ozon.ru'],
  ['lalafo', 'lalafo.kg'],
  ['kfc', 'kfc.com'],
  ['megacom', 'megacom.kg'],
  ['beeline', 'beeline.kg'],
  ['mbank', 'mbank.kg'],
  ['simbank', 'simbank.kg'],
  ['o!bank', 'obank.kg'], ['o!деньги', 'obank.kg'], ['o!dengi', 'obank.kg'],
  ['netflix', 'netflix.com'], ['spotify', 'spotify.com'], ['youtube', 'youtube.com'], ['apple.com', 'apple.com'],
  ['anthropic', 'anthropic.com']
];

const IMAGE_URL = /^https?:\/\/.+\.(png|jpe?g|svg|webp|gif|ico)(\?.*)?$/i;

/** Источник логотипа для названия: сначала свои правила (с листа «Логотипы»), потом встроенные. */
export function logoSourceFor(merchant: string, userLogos: [string, string][] = []): string | null {
  const m = merchant.toLowerCase();
  for (const [pattern, source] of [...userLogos, ...DEFAULT_LOGOS]) {
    if (pattern && m.includes(pattern)) return source;
  }
  return null;
}

/** Адреса картинок по порядку попыток. */
export function logoCandidates(source: string): string[] {
  if (IMAGE_URL.test(source)) return [source];
  const domain = source.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/[/?#].*$/, '').toLowerCase();
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`
  ];
}

/** Места, которым стоит поискать логотип: без логотипа, не частные лица и не служебные записи. */
const PERSON = /^[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?\s+[А-ЯЁA-Z]\.(?:\s*[А-ЯЁA-Z]\.)?$/i;
const SKIP_CATEGORIES = new Set(['Переводы', 'Семья', 'Не учитывать', 'Кредит и комиссии']);

export function merchantsWithoutLogo(
  txs: { merchant: string; category: string }[],
  userLogos: [string, string][] = [],
  limit = 25
): string[] {
  const counts = new Map<string, { name: string; n: number }>();
  for (const t of txs) {
    const name = t.merchant.trim();
    if (!name || name.length < 3 || SKIP_CATEGORIES.has(t.category) || PERSON.test(name)) continue;
    if (/^(комиссия|проценты|маршрутка|без названия|перевод)/i.test(name)) continue;
    if (logoSourceFor(name, userLogos)) continue;
    const key = name.toLowerCase();
    const e = counts.get(key) ?? { name, n: 0 };
    e.n++;
    counts.set(key, e);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(e => e.name);
}
