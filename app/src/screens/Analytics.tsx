import { memo } from 'react';
import { Card, Empty } from '../components/ui';
import { CategoryBars } from '../components/charts';
import { DailyChart, MonthlyChart } from '../components/TimeCharts';
import { ChartSk } from '../components/Skeletons';
import { CategoryBadge } from '../lib/categories';
import { formatMoney } from '../lib/format';
import { byCategory, byDay, byMerchant, byMonth, inMonth, monthKey, summarize, type MonthKey } from '../lib/stats';
import type { Transaction } from '../lib/types';

export const Analytics = memo(function Analytics({ txs, month, active, onMonth, onCategory }: {
  txs: Transaction[];
  month: MonthKey;
  active: boolean;
  onMonth: (k: MonthKey) => void;
  onCategory: (c: string) => void;
}) {
  const monthTx = inMonth(txs, month);
  const s = summarize(txs, month);
  const days = byDay(monthTx, month);
  const merchants = byMerchant(monthTx, 8);
  const biggest = [...monthTx].sort((a, b) => b.amount - a.amount)[0];
  const avgCheck = monthTx.length ? s.total / monthTx.length : 0;
  const maxDay = days.reduce((m, d) => (d.total > m.total ? d : m), days[0]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Tile label="Средний чек" value={formatMoney(avgCheck)} />
        <Tile label="В день" value={formatMoney(s.perDay)} />
        <Tile label="Самый дорогой день" value={maxDay?.total ? formatMoney(maxDay.total) : '—'} hint={maxDay?.total ? `${maxDay.day} число` : undefined} />
        <Tile label="Крупнейшая трата" value={biggest ? formatMoney(biggest.amount) : '—'} hint={biggest?.merchant} />
      </div>

      <Card title="По дням" action={s.perDay > 0 ? (
        <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <span className="inline-block h-px w-4 bg-ink-2" /> в среднем {formatMoney(s.perDay)}
        </span>
      ) : undefined}>
        {!monthTx.length ? <Empty>Нет данных</Empty> : active ? <DailyChart data={days} month={month} average={s.perDay} /> : <ChartSk />}
      </Card>

      <Card title="По месяцам">
        {active ? <MonthlyChart data={byMonth(txs, monthKey(new Date()), 12)} selected={month} onSelect={onMonth} /> : <ChartSk />}
      </Card>

      <Card title="Все категории">
        {monthTx.length ? <CategoryBars items={byCategory(monthTx)} onPick={onCategory} /> : <Empty>Нет данных</Empty>}
      </Card>

      <Card title="Где тратишь больше всего">
        {merchants.length === 0 && <Empty>Нет данных</Empty>}
        <ol className="space-y-1">
          {merchants.map((m, i) => (
            <li key={m.merchant} className="flex items-center gap-3 px-1 py-2">
              <span className="tnum w-5 text-center text-[13px] font-semibold text-ink-3">{i + 1}</span>
              <CategoryBadge category={m.category} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{m.merchant}</span>
                <span className="block text-[13px] text-ink-3">{m.count} раз · {m.category}</span>
              </span>
              <span className="tnum text-[15px] font-semibold">{formatMoney(m.total)}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
});

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl bg-surface p-4">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold leading-tight">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}
