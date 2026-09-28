import { Plus } from 'lucide-react';
import { Card, Empty } from '../components/ui';
import { BudgetMeter } from '../components/charts';
import { CategoryBadge } from '../lib/categories';
import { formatMoney } from '../lib/format';
import { byCategory, daysInMonth, inMonth, summarize, type MonthKey } from '../lib/stats';
import type { AppData, Transaction } from '../lib/types';

export function Budgets({ data, txs, month, onEdit }: {
  data: AppData; txs: Transaction[]; month: MonthKey; onEdit: (category: string) => void;
}) {
  const s = summarize(txs, month);
  const cats = byCategory(inMonth(txs, month));
  const spentOf = (c: string) => cats.find(x => x.category === c)?.total ?? 0;
  const entries = Object.entries(data.budgets).sort((a, b) => spentOf(b[0]) / b[1] - spentOf(a[0]) / a[1]);
  const totalLimit = entries.reduce((sum, [, l]) => sum + l, 0);
  const totalSpent = entries.reduce((sum, [c]) => sum + spentOf(c), 0);
  const without = data.categories.filter(c => !(c in data.budgets) && c !== data.excludedCategory && c !== data.uncategorized);
  const project = (spent: number) => (s.forecast !== null && s.elapsedDays ? (spent / s.elapsedDays) * daysInMonth(month) : null);

  return (
    <div className="space-y-3">
      {entries.length > 0 && (
        <Card>
          <div className="text-[13px] text-ink-3">Все бюджеты за месяц</div>
          <div className="tnum mt-1 text-[28px] font-semibold">
            {formatMoney(totalSpent)} <span className="text-[17px] font-medium text-ink-3">из {formatMoney(totalLimit)}</span>
          </div>
        </Card>
      )}
      <Card title="Лимиты">
        {entries.length === 0 && <Empty>Задай лимит на категорию — например, «Кафе и еда» 6 000 с в месяц</Empty>}
        {entries.map(([c, limit]) => (
          <BudgetMeter key={c} category={c} spent={spentOf(c)} limit={limit} projected={project(spentOf(c))} onClick={() => onEdit(c)} />
        ))}
      </Card>
      <Card title="Добавить лимит">
        <div className="grid grid-cols-2 gap-2">
          {without.map(c => (
            <button key={c} onClick={() => onEdit(c)} className="flex items-center gap-2 rounded-2xl bg-surface-2 p-2 text-left text-[13px] font-medium active:scale-[0.98] transition">
              <CategoryBadge category={c} size={30} />
              <span className="min-w-0 flex-1 truncate">{c}</span>
              <Plus size={16} className="text-ink-3" />
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
