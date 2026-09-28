// Рендерит PNG-иконки из public/favicon.svg (запускать при изменении иконки): node scripts/icons.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
// Для iOS и maskable нужен квадрат без скругления — система скругляет сама.
const square = svg.replace('rx="112"', 'rx="0"');
const targets = [
  ['apple-touch-icon.png', 180, square, 1],
  ['icon-192.png', 192, svg, 1],
  ['icon-512.png', 512, svg, 1],
  ['icon-512-maskable.png', 512, square, 0.8]
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage();
for (const [name, size, src, scale] of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inner = scale === 1 ? src : src.replace('<rect width="512" height="512" rx="0" fill="url(#g)"/>',
    '<rect width="512" height="512" fill="url(#g)"/><g transform="translate(51.2 51.2) scale(0.8)">').replace('</svg>', '</g></svg>');
  await page.setContent(`<html><body style="margin:0">${inner.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
console.log('icons ok');
