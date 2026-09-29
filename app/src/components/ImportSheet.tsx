import { useEffect, useState } from 'react';
import { CheckCircle2, FileText, Sparkles, TriangleAlert } from 'lucide-react';
import { Sheet } from './ui';
import { formatMoney } from '../lib/format';
import { categorizeUnknown, importStatement, type ImportResult } from '../lib/api';
import type { ParsedStatement } from '../lib/statement';
import type { Connection } from '../lib/types';

type Stage =
  | { kind: 'pick' }
  | { kind: 'reading'; name: string }
  | { kind: 'preview'; st: ParsedStatement }
  | { kind: 'importing'; st: ParsedStatement }
  | { kind: 'done'; result: ImportResult }
  | { kind: 'error'; message: string };

/**
 * Импорт PDF-выписки: файл разбирается прямо на телефоне (pdf.js), в скрипт уходят только операции.
 */
export function ImportSheet({ open, conn, onClose, onImported, notify }: {
  open: boolean;
  conn: Connection;
  onClose: () => void;
  onImported: () => void;
  notify: (t: string) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'pick' });
  const [categorizing, setCategorizing] = useState(false);
  useEffect(() => { if (open) setStage({ kind: 'pick' }); }, [open]);

  async function onFile(file: File) {
    setStage({ kind: 'reading', name: file.name });
    try {
      // pdf.js и парсер — отдельный чанк, грузится только когда импортируют выписку
      const { readPdfPages, parseSimbankPages, summarizeStatement } = await import('../lib/statement');
      const st = summarizeStatement(parseSimbankPages(await readPdfPages(file)));
      if (!st.expenses.length) throw new Error('В выписке не нашлось расходов');
      setStage({ kind: 'preview', st });
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function doImport(st: ParsedStatement) {
    setStage({ kind: 'importing', st });
    try {
      const result = await importStatement(conn, st.bank, st.expenses);
      setStage({ kind: 'done', result });
      onImported();
    } catch (e) {
      setStage({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function doCategorize() {
    setCategorizing(true);
    try {
      const r = await categorizeUnknown(conn);
      notify(r.message ?? 'Готово');
      onImported();
      onClose();
    } catch (e) {
      notify(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCategorizing(false);
    }
  }

  const btn = 'w-full rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 active:scale-[0.99] transition';

  return (
    <Sheet open={open} onClose={onClose} title="Импорт выписки">
      {stage.kind === 'pick' && (
        <div className="pb-2">
          <p className="mb-4 text-[15px] text-ink-2">
            Выбери PDF-выписку. Она разбирается <b className="text-ink">прямо на телефоне</b> — файл никуда не отправляется,
            Claude не нужен, это бесплатно. Операции, которые уже есть (Apple Pay, скрины), пропустятся.
          </p>
          <p className="mb-4 rounded-2xl bg-surface-2 p-3 text-[13px] text-ink-3">Пока поддерживается «Выписка по карте» Simbank.</p>
          <label className={btn + ' flex cursor-pointer items-center justify-center gap-2'}>
            <FileText size={18} /> Выбрать PDF
            <input type="file" accept="application/pdf,.pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          </label>
        </div>
      )}

      {stage.kind === 'reading' && <p className="py-10 text-center text-ink-2">Читаю «{stage.name}»…</p>}

      {(stage.kind === 'preview' || stage.kind === 'importing') && <Preview st={stage.st} busy={stage.kind === 'importing'} btn={btn} onImport={doImport} />}

      {stage.kind === 'done' && (
        <div className="pb-2">
          <div className="mb-4 flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 size={44} className="text-good" />
            <div className="text-lg font-semibold">Импорт завершён</div>
            <div className="text-ink-2">{stage.result.message}</div>
          </div>
          {(stage.result.uncategorized ?? 0) > 0 && (
            <button onClick={doCategorize} disabled={categorizing} className={btn + ' mb-2 flex items-center justify-center gap-2'}>
              <Sparkles size={18} /> {categorizing ? 'Claude разбирает…' : `Разобрать «Без категории» через Claude`}
            </button>
          )}
          {(stage.result.uncategorized ?? 0) > 0 && (
            <p className="mb-3 text-center text-[12px] text-ink-3">Один запрос на все места сразу, ≈ 3 цента. Ответ запомнится правилами.</p>
          )}
          <button onClick={onClose} className="mb-2 w-full rounded-2xl bg-surface-2 py-3.5 font-semibold">Готово</button>
        </div>
      )}

      {stage.kind === 'error' && (
        <div className="pb-2">
          <p className="mb-4 flex gap-2 rounded-2xl bg-critical/10 p-3 text-sm text-critical"><TriangleAlert size={18} className="shrink-0" /> {stage.message}</p>
          <button onClick={() => setStage({ kind: 'pick' })} className="mb-2 w-full rounded-2xl bg-surface-2 py-3.5 font-semibold">Выбрать другой файл</button>
        </div>
      )}
    </Sheet>
  );
}

function Preview({ st, busy, btn, onImport }: { st: ParsedStatement; busy: boolean; btn: string; onImport: (st: ParsedStatement) => void }) {
  const total = st.expenses.reduce((s, e) => s + e.amount, 0);
  const matches = st.declaredSpent !== null && Math.abs(total - st.declaredSpent) < 0.01;
  const recent = [...st.expenses].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  return (
    <div className="pb-2">
      <div className="mb-3 rounded-2xl bg-surface-2 p-4">
        <div className="text-[13px] text-ink-3">{st.bank} · {st.period}</div>
        <div className="tnum mt-1 text-[26px] font-semibold">{formatMoney(total, 'KGS', true)}</div>
        <div className="text-sm text-ink-2">{st.expenses.length} расходов · {st.income.length} поступлений (их не импортируем)</div>
        {st.declaredSpent !== null && (
          <div className={'mt-2 text-[13px] ' + (matches ? 'text-good' : 'text-warning')}>
            {matches ? '✓ Сходится с итогом в выписке' : `⚠️ В выписке указано ${formatMoney(st.declaredSpent, 'KGS', true)}`}
          </div>
        )}
      </div>
      <div className="mb-4 space-y-1.5">
        {recent.map((e, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate">{e.merchant}</span>
            <span className="tnum shrink-0 text-ink-2">{new Date(e.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · −{formatMoney(e.amount, 'KGS', true)}</span>
          </div>
        ))}
        {st.expenses.length > recent.length && <div className="text-[13px] text-ink-3">и ещё {st.expenses.length - recent.length}…</div>}
      </div>
      <button disabled={busy} onClick={() => onImport(st)} className={btn}>
        {busy ? 'Импортирую…' : `Импортировать ${st.expenses.length} расходов`}
      </button>
    </div>
  );
}
