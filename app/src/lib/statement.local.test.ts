// Проверка на реальной выписке (файл не хранится в репозитории):
// STATEMENT_PDF=/путь/к/выписке.pdf npx vitest run statement.local
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSimbankPages, summarizeStatement, type PdfPage } from './statement';

const file = process.env.STATEMENT_PDF;

describe.skipIf(!file)('реальная выписка Simbank', () => {
  it('сумма расходов сходится с шапкой выписки', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file!)) }).promise;
    const pages: PdfPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.flatMap(it => ('str' in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }] : [])));
    }
    const s = summarizeStatement(parseSimbankPages(pages));
    const spent = s.expenses.reduce((a, e) => a + e.amount, 0);
    const income = s.income.reduce((a, r) => a + r.amount, 0);
    console.log({ rows: s.rows.length, expenses: s.expenses.length, income: s.income.length, spent: spent.toFixed(2), declared: s.declaredSpent, incomeSum: income.toFixed(2) });
    console.log(s.expenses.filter(e => e.method !== 'card' || e.merchant.length > 22).slice(0, 12).map(e => `${e.date.slice(0, 16)} ${e.amount} | ${e.merchant} | ${e.method}/${e.recipient}${e.category ? ' → ' + e.category : ''}`).join('\n'));
    const merchants = new Map<string, number>();
    s.expenses.forEach(e => merchants.set(e.merchant, (merchants.get(e.merchant) ?? 0) + 1));
    console.log([...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([m, n]) => `${n}× ${m}`).join(' · '));
    expect(Math.abs(spent - (s.declaredSpent ?? 0))).toBeLessThan(0.01);
  });
});
