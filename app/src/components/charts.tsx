import { motion } from 'motion/react';
import { CategoryBadge } from '../lib/categories';
import { formatMoney } from '../lib/format';
import type { CategoryTotal } from '../lib/stats';

/** Категории по убыванию: иконка, сумма, доля и полоска одного цвета. */
export function CategoryBars({ items, onPick, limit }: { items: CategoryTotal[]; onPick?: (c: string) => void; limit?: number }) {
  const max = items[0]?.total || 1;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="space-y-1">
      {shown.map((c, i) => (
        <li key={c.category}>
          <button onClick={() => onPick?.(c.category)} className="flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left active:bg-surface-2 transition-colors">
            <CategoryBadge category={c.category} size={36} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[15px] font-medium">{c.category}</span>
                <span className="tnum shrink-0 text-[15px] font-semibold">{formatMoney(c.total)}</span>
              </span>
              <span className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <motion.span
                    className="block h-full rounded-full bg-accent"
                    initial={{ width: 0 }} animate={{ width: `${(c.total / max) * 100}%` }}
                    transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
                <span className="tnum w-10 shrink-0 text-right text-[12px] text-ink-3">{Math.round(c.share * 100)}%</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Полоска бюджета: цвет заполнения = состояние, трек — светлый шаг того же тона. Состояние дублируется текстом. */
export function BudgetMeter({ category, spent, limit, projected, onClick }: {
  category: string; spent: number; limit: number; projected: number | null; onClick?: () => void;
}) {
  const ratio = spent / limit;
  const state = ratio >= 1 ? 'over' : (projected ?? spent) > limit || ratio >= 0.85 ? 'warn' : 'ok';
  const fill = state === 'over' ? 'var(--critical)' : state === 'warn' ? 'var(--warning)' : 'var(--accent)';
  const left = limit - spent;
  return (
    <button onClick={onClick} className="w-full rounded-2xl px-1 py-2 text-left active:bg-surface-2 transition-colors">
      <div className="flex items-center gap-3">
        <CategoryBadge category={category} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-medium">{category}</span>
            <span className="tnum shrink-0 text-[13px] text-ink-2">
              <span className="font-semibold text-ink">{formatMoney(spent)}</span> из {formatMoney(limit)}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in oklab, ' + fill + ' 18%, transparent)' }}>
            <motion.div className="h-full rounded-full" style={{ background: fill }}
              initial={{ width: 0 }} animate={{ width: `${Math.min(ratio, 1) * 100}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
          </div>
          <div className="mt-1 text-[12px] text-ink-3">
            {state === 'over' ? `⛔ Превышен на ${formatMoney(-left)}`
              : state === 'warn' ? `⚠️ Осталось ${formatMoney(left)}${projected && projected > limit ? ' — по прогнозу не хватит' : ''}`
              : `Осталось ${formatMoney(left)}`}
          </div>
        </div>
      </div>
    </button>
  );
}
