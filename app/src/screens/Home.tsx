import { memo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, Empty } from '../components/ui';
import { BudgetMeter, CategoryBars } from '../components/charts';
import { TxRow } from '../components/TxRow';
import { formatMoney, monthName, pluralOps } from '../lib/format';
import { byCategory, daysInMonth, inMonth, sameMonth, monthKey, summarize, type MonthKey } from '../lib/stats';
import type { AppData, Transaction } from '../lib/types';

export const Home = memo(function Home({ data, txs, month, onCategory, onTx, onAll, onBudgets }: {
  data: AppData;
  txs: Transaction[];           // уже без «Не учитывать»
  month: MonthKey;
  onCategory: (c: string) => void;
  onTx: (t: Transaction) => void;
  onAll: () => void;
  onBudgets: () => void;
}) {
  const s = summarize(txs, month);
  const cats = byCategory(inMonth(txs, month));
  const current = sameMonth(month, monthKey(new Date()));
  const recent = inMonth(data.transactions, month).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const budgets = Object.entries(data.budgets);
  const up = (s.delta ?? 0) > 0;

  return (
    <div className="space-y-3">
      <section
        className="relative overflow-hidden rounded-[28px] p-5 text-white"
        // Блик — радиальный градиент, а не filter: blur (он дорогой для GPU iPhone при прокрутке).
        style={{ background: 'radial-gradient(circle at 92% -8%, rgb(255 255 255 / 0.16), transparent 42%), linear-gradient(135deg, var(--hero-from), var(--hero-to))' }}
      >
        <div className="text-[13px] font-medium text-white/75">Потрачено за {monthName(month.month).toLowerCase()}</div>
        <div className="mt-1 text-[48px] font-semibold leading-none tracking-tight">{formatMoney(s.total)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          {s.delta !== null && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-medium">
              {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {up ? '+' : '−'}{Math.abs(Math.round(s.delta * 100))}% к {current ? 'тому же дню' : ''} прошлого месяца
            </span>
          )}
          <span className="text-white/75">{pluralOps(s.count)}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Stat label="В среднем в день" value={formatMoney(s.perDay)} />
          {s.forecast !== null
            ? <Stat label="Прогноз на месяц" value={formatMoney(s.forecast)} />
            : <Stat label="Прошлый месяц" value={formatMoney(s.prevToDate)} />}
        </div>
      </section>

      <Card title="По категориям">
        {cats.length ? <CategoryBars items={cats} onPick={onCategory} limit={6} /> : <Empty>В этом месяце трат пока нет</Empty>}
        {cats.length > 6 && (
          <button onClick={() => onCategory('')} className="mt-1 w-full py-2 text-sm font-medium text-accent">
            Все категории
          </button>
        )}
      </Card>

      {budgets.length > 0 && (
        <Card title="Бюджеты" action={<button onClick={onBudgets} className="text-sm font-medium text-accent">Все</button>}>
          {budgets.slice(0, 3).map(([c, limit]) => {
            const spent = cats.find(x => x.category === c)?.total ?? 0;
            const projected = s.forecast !== null && s.elapsedDays ? (spent / s.elapsedDays) * daysInMonth(month) : null;
            return <BudgetMeter key={c} category={c} spent={spent} limit={limit} projected={projected} onClick={onBudgets} />;
          })}
        </Card>
      )}

      <Card title="Последние операции" action={<button onClick={onAll} className="text-sm font-medium text-accent">Все</button>}>
        {recent.length ? recent.map(t => <TxRow key={t.id} tx={t} excluded={data.excludedCategory} onClick={() => onTx(t)} />) : <Empty>Пока пусто</Empty>}
      </Card>
    </div>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/12 px-3 py-2.5">
      <div className="text-[12px] text-white/70">{label}</div>
      <div className="text-[17px] font-semibold">{value}</div>
    </div>
  );
}
