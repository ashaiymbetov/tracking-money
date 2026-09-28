import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Sheet } from './ui';
import { CategoryPicker } from './CategoryPicker';
import { formatMoney } from '../lib/format';
import type { Transaction } from '../lib/types';

export function EditCategorySheet({ tx, categories, onClose, onSave }: {
  tx: Transaction | null;
  categories: string[];
  onClose: () => void;
  onSave: (category: string, remember: boolean) => void;
}) {
  const [category, setCategory] = useState('');
  const [remember, setRemember] = useState(true);
  useEffect(() => { if (tx) { setCategory(tx.category); setRemember(true); } }, [tx]);

  return (
    <Sheet open={!!tx} onClose={onClose} title="Категория">
      {tx && (
        <>
          <div className="mb-4 rounded-2xl bg-surface-2 p-3">
            <div className="text-[15px] font-semibold">{tx.merchant}</div>
            <div className="tnum text-sm text-ink-2">
              {formatMoney(tx.amount, tx.currency, true)} · {new Date(tx.date).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <CategoryPicker categories={categories} value={category} onChange={setCategory} />
          <label className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-3">
            <span className="text-sm">
              <span className="block font-medium">Запомнить для «{tx.merchant}»</span>
              <span className="text-ink-3">Все прошлые и будущие операции получат эту категорию</span>
            </span>
            <Toggle checked={remember} onChange={setRemember} />
          </label>
          <button
            disabled={category === tx.category && !remember}
            onClick={() => onSave(category, remember)}
            className="mt-4 mb-2 w-full rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 active:scale-[0.99] transition"
          >
            Сохранить
          </button>
        </>
      )}
    </Sheet>
  );
}

export function AddExpenseSheet({ open, categories, onClose, onSave }: {
  open: boolean;
  categories: string[];
  onClose: () => void;
  onSave: (amount: number, merchant: string, category: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('Другое');
  useEffect(() => { if (open) { setAmount(''); setMerchant(''); setCategory('Другое'); } }, [open]);
  const value = Number(amount.replace(',', '.'));
  const pickable = categories.filter(c => c !== 'Без категории');

  return (
    <Sheet open={open} onClose={onClose} title="Новый расход">
      <div className="mb-3 flex items-baseline justify-center gap-2 py-2">
        <input
          autoFocus inputMode="decimal" placeholder="0" value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
          className="tnum w-full bg-transparent text-center text-5xl font-semibold outline-none placeholder:text-ink-3"
          style={{ fontSize: 48 }}
        />
        <span className="text-3xl font-semibold text-ink-3">с</span>
      </div>
      <input
        placeholder="Где или на что" value={merchant} onChange={e => setMerchant(e.target.value)}
        className="mb-4 w-full rounded-2xl bg-surface-2 px-4 py-3 outline-none placeholder:text-ink-3"
      />
      <CategoryPicker categories={pickable} value={category} onChange={setCategory} />
      <button
        disabled={!(value > 0)}
        onClick={() => onSave(value, merchant.trim(), category)}
        className="mt-4 mb-2 w-full rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 active:scale-[0.99] transition"
      >
        Добавить
      </button>
    </Sheet>
  );
}

export function BudgetSheet({ category, current, onClose, onSave }: {
  category: string | null;
  current: number;
  onClose: () => void;
  onSave: (limit: number) => void;
}) {
  const [limit, setLimit] = useState('');
  useEffect(() => { if (category) setLimit(current ? String(current) : ''); }, [category, current]);
  const value = Number(limit.replace(',', '.')) || 0;
  return (
    <Sheet open={!!category} onClose={onClose} title={category ? `Бюджет: ${category}` : ''}>
      <p className="mb-2 text-sm text-ink-3">Сколько готов тратить на эту категорию в месяц</p>
      <div className="mb-4 flex items-baseline justify-center gap-2 py-2">
        <input
          autoFocus inputMode="numeric" placeholder="0" value={limit}
          onChange={e => setLimit(e.target.value.replace(/[^\d]/g, ''))}
          className="tnum w-full bg-transparent text-center font-semibold outline-none placeholder:text-ink-3"
          style={{ fontSize: 48 }}
        />
        <span className="text-3xl font-semibold text-ink-3">с</span>
      </div>
      <div className="mb-2 flex gap-2">
        {current > 0 && (
          <button onClick={() => onSave(0)} className="flex-1 rounded-2xl bg-surface-2 py-3.5 font-semibold text-critical">
            Убрать
          </button>
        )}
        <button
          disabled={!(value > 0)} onClick={() => onSave(value)}
          className="flex-[2] rounded-2xl bg-accent py-3.5 font-semibold text-white disabled:opacity-40"
        >
          Сохранить
        </button>
      </div>
    </Sheet>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-good' : 'bg-line')}
    >
      <span className={clsx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}
