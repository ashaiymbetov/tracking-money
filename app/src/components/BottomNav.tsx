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

// Пружина с лёгким перелётом — индикатор «перетекает» между вкладками, как в iOS 26.
const liquid = { type: 'spring', stiffness: 480, damping: 32, mass: 0.9 } as const;

/** Плавающий таб-бар в стиле Liquid Glass: капсула с вкладками + отдельная круглая кнопка «+». */
export function BottomNav({ tab, onTab, onAdd }: { tab: Tab; onTab: (t: Tab) => void; onAdd: () => void }) {
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3"
      style={{ paddingBottom: 'max(calc(env(safe-area-inset-bottom) - 10px), 10px)' }}
    >
      <div className="mx-auto flex max-w-lg items-center gap-2.5">
        <div className="glass pointer-events-auto flex h-[62px] flex-1 items-center rounded-full p-1">
          {TABS.map(t => {
            const active = tab === t.id;
            return (
              <motion.button
                key={t.id}
                onClick={() => onTab(t.id)}
                whileTap={{ scale: 0.9 }}
                transition={liquid}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-semibold transition-colors duration-200',
                  active ? 'text-accent' : 'text-ink'
                )}
              >
                {active && <motion.span layoutId="glass-tab" transition={liquid} className="glass-pill absolute inset-0 -z-10 rounded-full" />}
                <t.Icon size={23} strokeWidth={active ? 2.5 : 2.1} />
                <span className="leading-none">{t.label}</span>
              </motion.button>
            );
          })}
        </div>
        <motion.button
          onClick={onAdd}
          whileTap={{ scale: 0.88 }}
          transition={liquid}
          aria-label="Добавить расход"
          className="glass pointer-events-auto flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full text-accent"
        >
          <Plus size={28} strokeWidth={2.6} />
        </motion.button>
      </div>
    </nav>
  );
}
