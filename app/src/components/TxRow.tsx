import clsx from 'clsx';
import { CategoryBadge } from '../lib/categories';
import { formatMoney, formatTime } from '../lib/format';
import type { Transaction } from '../lib/types';

export function TxRow({ tx, excluded, onClick }: { tx: Transaction; excluded: string; onClick?: () => void }) {
  const off = tx.category === excluded;
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left active:bg-surface-2 transition-colors">
      <CategoryBadge category={tx.category} />
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-[15px] font-medium', off && 'text-ink-3 line-through decoration-ink-3/50')}>
          {tx.merchant || 'Без названия'}
        </span>
        <span className="block truncate text-[13px] text-ink-3">
          {tx.category} · {formatTime(new Date(tx.date))}{tx.card ? ` · ${tx.card}` : ''}
        </span>
      </span>
      <span className={clsx('tnum shrink-0 text-[15px] font-semibold', off ? 'text-ink-3' : 'text-ink')}>
        −{formatMoney(tx.amount, tx.currency, true)}
      </span>
    </button>
  );
}
