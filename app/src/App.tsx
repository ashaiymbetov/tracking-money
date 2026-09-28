import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut, RefreshCw, Settings } from 'lucide-react';
import clsx from 'clsx';
import { BottomNav, type Tab } from './components/BottomNav';
import { MonthSwitcher, Sheet, Toast } from './components/ui';
import { AddExpenseSheet, BudgetSheet, EditCategorySheet } from './components/sheets';
import { Home } from './screens/Home';
import { Transactions } from './screens/Transactions';
import { Budgets } from './screens/Budgets';
import { Setup } from './screens/Setup';
import { loadConnection, saveConnection } from './lib/config';
import { clearCache, useAddExpense, useData, useSetBudget, useSetCategory } from './lib/queries';
import { countable, monthKey, shiftMonth, type MonthKey } from './lib/stats';
import type { Connection, Transaction } from './lib/types';

// Recharts тяжёлый — грузим аналитику отдельным чанком, главная открывается сразу.
const Analytics = lazy(() => import('./screens/Analytics').then(m => ({ default: m.Analytics })));

const TITLES: Record<Tab, string> = { home: 'Обзор', list: 'Операции', stats: 'Аналитика', budgets: 'Бюджеты' };

export default function App() {
  const [conn, setConn] = useState<Connection | null>(() =>
    new URLSearchParams(location.search).has('demo') ? { url: '', token: '', demo: true } : loadConnection());

  if (!conn) return <Setup onDone={c => { saveConnection(c); setConn(c); }} />;
  return <Main conn={conn} onLogout={() => { saveConnection(null); clearCache(); setConn(null); }} />;
}

function Main({ conn, onLogout }: { conn: Connection; onLogout: () => void }) {
  const query = useData(conn);
  const data = query.data;
  const [tab, setTab] = useState<Tab>('home');
  const [month, setMonth] = useState<MonthKey>(() => monthKey(new Date()));
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [budgetFor, setBudgetFor] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const setCategory = useSetCategory(conn);
  const setBudget = useSetBudget(conn);
  const addExpense = useAddExpense(conn);

  const notify = useCallback((t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); }, []);
  const onError = useCallback((e: Error) => notify(`⚠️ ${e.message}`), [notify]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);

  const txs = useMemo(() => (data ? countable(data) : []), [data]);
  const now = monthKey(new Date());
  const minMonth = shiftMonth(now, -12);

  if (!data) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-8 text-center">
        {query.isError ? (
          <>
            <p className="text-ink-2">⚠️ {(query.error as Error).message}</p>
            <button onClick={() => query.refetch()} className="rounded-2xl bg-accent px-5 py-3 font-semibold text-white">Повторить</button>
            <button onClick={onLogout} className="text-sm text-ink-3">Изменить подключение</button>
          </>
        ) : (
          <RefreshCw className="animate-spin text-ink-3" />
        )}
      </div>
    );
  }

  const openCategory = (c: string) => { setFilter(c); setTab('list'); };

  return (
    <div className="mx-auto min-h-full max-w-lg">
      <header className="pt-safe sticky top-0 z-20 bg-bg/85 px-4 pb-2 backdrop-blur-xl">
        <div className="flex items-center justify-between pt-1">
          <h1 className="text-[28px] font-bold tracking-tight">{TITLES[tab]}</h1>
          <div className="flex items-center gap-1">
            {conn.demo && <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-semibold text-ink-2">демо</span>}
            <button onClick={() => query.refetch()} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2" aria-label="Обновить">
              <RefreshCw size={18} className={clsx(query.isFetching && 'animate-spin')} />
            </button>
            <button onClick={() => setSettings(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2" aria-label="Настройки">
              <Settings size={18} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex justify-center">
          <MonthSwitcher value={month} onChange={setMonth} min={minMonth} max={now} />
        </div>
      </header>

      <main className="px-4 pt-2 pb-32">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {tab === 'home' && (
              <Home data={data} txs={txs} month={month} onCategory={openCategory} onTx={setEditing}
                onAll={() => { setFilter(''); setTab('list'); }} onBudgets={() => setTab('budgets')} />
            )}
            {tab === 'list' && <Transactions data={data} month={month} category={filter} onCategory={setFilter} onTx={setEditing} />}
            {tab === 'stats' && (
              <Suspense fallback={<div className="flex justify-center py-20"><RefreshCw className="animate-spin text-ink-3" /></div>}>
                <Analytics txs={txs} month={month} onMonth={setMonth} onCategory={openCategory} />
              </Suspense>
            )}
            {tab === 'budgets' && <Budgets data={data} txs={txs} month={month} onEdit={setBudgetFor} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <BottomNav tab={tab} onTab={t => { if (t !== 'list') setFilter(''); setTab(t); }} onAdd={() => setAdding(true)} />

      <EditCategorySheet
        tx={editing} categories={data.categories} onClose={() => setEditing(null)}
        onSave={(category, remember) => {
          const t = editing!;
          setEditing(null);
          setCategory.mutate({ id: t.id, merchant: t.merchant, category, remember }, {
            onSuccess: () => notify(remember ? `Запомнил: ${t.merchant} → ${category}` : 'Категория изменена'),
            onError
          });
        }}
      />
      <AddExpenseSheet
        open={adding} categories={data.categories} onClose={() => setAdding(false)}
        onSave={(amount, merchant, category) => {
          setAdding(false);
          addExpense.mutate({ amount, merchant, category }, { onSuccess: () => notify('Расход добавлен'), onError });
        }}
      />
      <BudgetSheet
        category={budgetFor} current={budgetFor ? data.budgets[budgetFor] ?? 0 : 0} onClose={() => setBudgetFor(null)}
        onSave={limit => {
          const c = budgetFor!;
          setBudgetFor(null);
          setBudget.mutate({ category: c, limit }, { onSuccess: () => notify(limit ? 'Бюджет сохранён' : 'Бюджет убран'), onError });
        }}
      />
      <Sheet open={settings} onClose={() => setSettings(false)} title="Настройки">
        <div className="mb-3 rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
          {conn.demo ? 'Сейчас показаны демо-данные.' : <>Подключено к таблице.<br /><span className="break-all text-ink-3">{conn.url}</span></>}
          <div className="mt-2 text-ink-3">Обновлено: {new Date(data.generatedAt).toLocaleString('ru-RU')}</div>
        </div>
        <button onClick={onLogout} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3.5 font-semibold text-critical">
          <LogOut size={18} /> {conn.demo ? 'Подключить свою таблицу' : 'Отключить'}
        </button>
      </Sheet>
      <Toast text={toast} />
    </div>
  );
}
