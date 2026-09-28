import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, type ReactNode } from 'react';
import { monthName } from '../lib/format';
import type { MonthKey } from '../lib/stats';

export function Card({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-3xl bg-surface p-4 shadow-[0_1px_0_var(--line)]', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function MonthSwitcher({ value, onChange, min, max }: { value: MonthKey; onChange: (k: MonthKey) => void; min: MonthKey; max: MonthKey }) {
  const idx = (k: MonthKey) => k.year * 12 + k.month;
  const shift = (d: number) => {
    const n = idx(value) + d;
    onChange({ year: Math.floor(n / 12), month: n % 12 });
  };
  const btn = 'flex h-9 w-9 items-center justify-center rounded-full bg-surface text-ink-2 disabled:opacity-30 active:scale-95 transition';
  return (
    <div className="flex items-center gap-2">
      <button className={btn} onClick={() => shift(-1)} disabled={idx(value) <= idx(min)} aria-label="Предыдущий месяц">
        <ChevronLeft size={18} />
      </button>
      <span className="min-w-28 text-center text-[15px] font-semibold">
        {monthName(value.month)}{value.year !== new Date().getFullYear() ? ` ${value.year}` : ''}
      </span>
      <button className={btn} onClick={() => shift(1)} disabled={idx(value) >= idx(max)} aria-label="Следующий месяц">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

/** Нижняя шторка в стиле iOS: тянется вниз, чтобы закрыть. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/45"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog" aria-label={title}
            className="pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] max-w-lg flex-col rounded-t-[28px] bg-surface will-change-transform"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 34, stiffness: 380, mass: 0.8 }}
            drag="y" dragListener={false} dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 500) onClose(); }}
          >
            {/* Тянуть вниз можно за верхнюю часть; содержимое ниже прокручивается как обычно. */}
            <div className="shrink-0 cursor-grab touch-none px-4 pt-2" onPointerDown={e => drag.start(e)}>
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line" />
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold">{title}</h3>
                <button onClick={onClose} onPointerDown={e => e.stopPropagation()}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-ink-2" aria-label="Закрыть">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function Toast({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          className="fixed inset-x-0 top-0 z-[60] flex justify-center pt-safe"
          initial={{ y: -40, opacity: 0 }} animate={{ y: 8, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
        >
          <div className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg shadow-lg">{text}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-3">{children}</p>;
}
