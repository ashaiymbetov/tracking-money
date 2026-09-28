import { Search, X } from 'lucide-react';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { Card, Empty } from '../components/ui';
import { TxRow } from '../components/TxRow';
import { formatDayHeader, formatMoney } from '../lib/format';
import { groupByDay, inMonth, type MonthKey } from '../lib/stats';
import type { AppData, Transaction } from '../lib/types';

export function Transactions({ data, month, category, onCategory, onTx }: {
  data: AppData;
  month: MonthKey;
  category: string;
  onCategory: (c: string) => void;
  onTx: (t: Transaction) => void;
}) {
  const [q, setQ] = useState('');
  const monthTx = useMemo(() => inMonth(data.transactions, month), [data, month]);
  const present = useMemo(() => [...new Set(monthTx.map(t => t.category))].sort(), [monthTx]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return monthTx.filter(t =>
      (!category || t.category === category) &&
      (!needle || t.merchant.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle) || String(t.amount).includes(needle)));
  }, [monthTx, category, q]);
  const groups = groupByDay(filtered, data.excludedCategory);
  const total = filtered.filter(t => t.category !== data.excludedCategory).reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-2xl bg-surface px-3">
        <Search size={18} className="text-ink-3" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: магазин, категория, сумма"
          className="w-full bg-transparent py-3 outline-none placeholder:text-ink-3" />
        {q && <button onClick={() => setQ('')} aria-label="Очистить"><X size={18} className="text-ink-3" /></button>}
      </div>

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {['', ...present].map(c => (
          <button key={c || 'all'} onClick={() => onCategory(c)}
            className={clsx('shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition',
              c === category ? 'bg-accent text-white' : 'bg-surface text-ink-2')}>
            {c || 'Все'}
          </button>
        ))}
      </div>

      {(category || q) && (
        <div className="px-1 text-sm text-ink-2">
          Итого: <span className="tnum font-semibold text-ink">{formatMoney(total)}</span>
        </div>
      )}

      {groups.length === 0 && <Card><Empty>Ничего не найдено</Empty></Card>}
      {groups.map(g => (
        <Card key={g.key} className="!py-3">
          <div className="mb-1 flex items-baseline justify-between px-1">
            <span className="text-[13px] font-semibold text-ink-2">{formatDayHeader(g.date)}</span>
            <span className="tnum text-[13px] text-ink-3">{formatMoney(g.total)}</span>
          </div>
          {g.items.map(t => <TxRow key={t.id} tx={t} excluded={data.excludedCategory} onClick={() => onTx(t)} />)}
        </Card>
      ))}
    </div>
  );
}
