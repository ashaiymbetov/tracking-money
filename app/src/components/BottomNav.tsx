import { ChartColumn, House, List, Plus, Target } from 'lucide-react';
import clsx from 'clsx';
import { motion } from 'motion/react';

export type Tab = 'home' | 'list' | 'stats' | 'budgets';

const TABS: { id: Tab; label: string; Icon: typeof House }[] = [
  { id: 'home', label: 'Главная', Icon: House },
  { id: 'list', label: 'Операции', Icon: List },
  { id: 'stats', label: 'Аналитика', Icon: ChartColumn },
  { id: 'budgets', label: 'Бюджеты', Icon: Target }
];

export function BottomNav({ tab, onTab, onAdd }: { tab: Tab; onTab: (t: Tab) => void; onAdd: () => void }) {
  const item = (t: (typeof TABS)[number]) => (
    <button
      key={t.id}
      onClick={() => onTab(t.id)}
      className={clsx('relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium transition-colors',
        tab === t.id ? 'text-accent' : 'text-ink-3')}
      aria-current={tab === t.id ? 'page' : undefined}
    >
      {tab === t.id && (
        <motion.span layoutId="nav-pill" transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          className="absolute inset-x-3 inset-y-0 -z-10 rounded-2xl bg-accent-soft/60" />
      )}
      <t.Icon size={22} strokeWidth={tab === t.id ? 2.4 : 2} />
      {t.label}
    </button>
  );
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-lg backdrop-saturate-150 [transform:translateZ(0)]">
      <div className="mx-auto flex max-w-lg items-center px-2 pt-1.5">
        {TABS.slice(0, 2).map(item)}
        <button
          onClick={onAdd}
          className="mx-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/30 active:scale-95 transition"
          aria-label="Добавить расход"
        >
          <Plus size={26} strokeWidth={2.4} />
        </button>
        {TABS.slice(2).map(item)}
      </div>
    </nav>
  );
}
