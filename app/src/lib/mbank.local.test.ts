// Проверка на реальной выписке MBank (файл не хранится в репозитории):
// MBANK_PDF=/путь/к/выписке.pdf npx vitest run mbank.local
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseStatement, type PdfPage } from './statement';

const file = process.env.MBANK_PDF;

describe.skipIf(!file)('реальная выписка MBank', () => {
  it('все списания сходятся с итогом выписки', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file!)) }).promise;
    const pages: PdfPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      pages.push(c.items.flatMap(it => ('str' in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }] : [])));
    }
    const s = parseStatement(pages);
    const spent = s.expenses.reduce((a, e) => a + e.amount, 0);
    console.log({ bank: s.bank, period: s.period, rows: s.rows.length, expenses: s.expenses.length, income: s.income.length, spent: spent.toFixed(2), debits: s.debits.toFixed(2), declared: s.declaredSpent, excluded: s.excluded });
    console.log(s.expenses.map(e => `${e.date.slice(0, 16)} ${e.amount} | ${e.merchant} | ${e.method}/${e.recipient}${e.category ? ' → ' + e.category : ''}`).join('\n'));
    expect(s.rows.length).toBeGreaterThan(0);
    expect(Math.abs(s.debits - (s.declaredSpent ?? 0))).toBeLessThan(0.01);
  });
});
