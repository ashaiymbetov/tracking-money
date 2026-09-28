import clsx from 'clsx';
import { CategoryBadge } from '../lib/categories';

export function CategoryPicker({ categories, value, onChange }: { categories: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {categories.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={clsx(
            'flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center text-[12px] font-medium leading-tight transition',
            c === value ? 'bg-accent text-white' : 'bg-surface-2 text-ink-2 active:scale-95'
          )}
        >
          <CategoryBadge category={c} size={34} />
          {c}
        </button>
      ))}
    </div>
  );
}
