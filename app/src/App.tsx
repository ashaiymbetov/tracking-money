import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LogOut, RefreshCw, Settings } from 'lucide-react';
import clsx from 'clsx';
import { BottomNav, type Tab } from './components/BottomNav';
import { MonthSwitcher, Sheet, Toast } from './components/ui';
import { AddExpenseSheet, BudgetSheet, EditCategorySheet } from './components/sheets';
import { Home } from './screens/Home';
import { Transactions } from './screens/Transactions';
import { Budgets } from './screens/Budgets';
import { Setup } from './screens/Setup';
import { AnalyticsSkeleton, BudgetsSkeleton, HomeSkeleton, ListSkeleton } from './components/Skeletons';
import { loadConnection, saveConnection } from './lib/config';
import { clearCache, useAddExpense, useData, useSetBudget, useSetCategory } from './lib/queries';
import { countable, monthKey, shiftMonth, type MonthKey } from './lib/stats';
import type { Connection, Transaction } from './lib/types';

// Recharts тяжёлый — грузим аналитику отдельным чанком, главная открывается сразу (а чанк подгружаем в фоне).
const loadAnalytics = () => import('./screens/Analytics');
const Analytics = lazy(() => loadAnalytics().then(m => ({ default: m.Analytics })));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Вкладка — собственная область прокрутки. Остаётся смонтированной после первого открытия
 * (как в нативных приложениях): переключение мгновенное, позиция прокрутки своя у каждой вкладки.
 */
function TabPanel({ active, panelRef, onScrolled, children }: {
  active: boolean;
  panelRef: (el: HTMLDivElement | null) => void;
  onScrolled: (scrolled: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!active || !ref.current) return;
    onScrolled(ref.current.scrollTop > 4);
    if (reducedMotion()) return;
    ref.current.animate(
      [{ opacity: 0, transform: 'translate3d(0, 8px, 0)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }, [active, onScrolled]);
  return (
    <div
      ref={el => { ref.current = el; panelRef(el); }}
      hidden={!active}
      onScroll={e => onScrolled(e.currentTarget.scrollTop > 4)}
      className="tab-scroll absolute inset-0 px-4 pt-2"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 104px)' }}
    >
      {children}
    </div>
  );
}

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
  const visited = useRef(new Set<Tab>(['home']));
  visited.current.add(tab);
  const scrollByTab = useRef<Partial<Record<Tab, number>>>({});
  const panels = useRef<Partial<Record<Tab, HTMLDivElement | null>>>({});
  const panelRefs = useMemo(() => {
    const make = (t: Tab) => (el: HTMLDivElement | null) => { panels.current[t] = el; };
    return { home: make('home'), list: make('list'), stats: make('stats'), budgets: make('budgets') };
  }, []);
  const [scrolled, setScrolled] = useState(false);   // тонкая линия под шапкой, когда контент уехал под неё
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

  // У каждой вкладки своя позиция прокрутки (display:none сбрасывает scrollTop — восстанавливаем сами).
  useLayoutEffect(() => {
    const el = panels.current[tab];
    if (el) el.scrollTop = scrollByTab.current[tab] ?? 0;
  }, [tab]);
  const switchTab = useCallback((t: Tab, keepFilter = false) => {
    if (t === tab) { panels.current[t]?.scrollTo({ top: 0, behavior: 'smooth' }); return; }   // повторное нажатие — наверх, как в iOS
    scrollByTab.current[tab] = panels.current[tab]?.scrollTop ?? 0;
    if (t !== 'list' && !keepFilter) setFilter('');
    setTab(t);
  }, [tab]);

  // Стабильные колбэки: экраны обёрнуты в memo и не перерисовываются, когда открывается шторка и т. п.
  const openCategory = useCallback((c: string) => { setFilter(c); scrollByTab.current.list = 0; switchTab('list', true); }, [switchTab]);
  const openAll = useCallback(() => { setFilter(''); switchTab('list', true); }, [switchTab]);
  const openBudgets = useCallback(() => switchTab('budgets'), [switchTab]);

  // Фоном подгружаем аналитику, чтобы первый переход на неё был мгновенным.
  useEffect(() => { const id = setTimeout(loadAnalytics, 1500); return () => clearTimeout(id); }, []);

  const txs = useMemo(() => (data ? countable(data) : []), [data]);
  const now = monthKey(new Date());
  const minMonth = shiftMonth(now, -12);

  return (
    <div className="fixed inset-0 mx-auto flex max-w-lg flex-col">
      <header className={clsx('pt-safe relative z-20 shrink-0 bg-bg px-4 pb-2 transition-shadow duration-200',
        scrolled && 'shadow-[0_1px_0_var(--line)]')}>
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

      <main className="relative min-h-0 flex-1">
        {!data ? (
          <div className="tab-scroll absolute inset-0 px-4 pt-2">
            {query.isError ? (
              <div className="mt-10 flex flex-col items-center gap-4 text-center">
                <p className="text-ink-2">⚠️ {(query.error as Error).message}</p>
                <button onClick={() => query.refetch()} className="rounded-2xl bg-accent px-5 py-3 font-semibold text-white">Повторить</button>
                <button onClick={onLogout} className="text-sm text-ink-3">Изменить подключение</button>
              </div>
            ) : tab === 'list' ? <ListSkeleton /> : tab === 'stats' ? <AnalyticsSkeleton /> : tab === 'budgets' ? <BudgetsSkeleton /> : <HomeSkeleton />}
          </div>
        ) : (
          <>
            <TabPanel active={tab === 'home'} panelRef={panelRefs.home} onScrolled={setScrolled}>
              <Home data={data} txs={txs} month={month} onCategory={openCategory} onTx={setEditing}
                onAll={openAll} onBudgets={openBudgets} />
            </TabPanel>
            {visited.current.has('list') && (
              <TabPanel active={tab === 'list'} panelRef={panelRefs.list} onScrolled={setScrolled}>
                <Transactions data={data} month={month} category={filter} onCategory={setFilter} onTx={setEditing} />
              </TabPanel>
            )}
            {visited.current.has('stats') && (
              <TabPanel active={tab === 'stats'} panelRef={panelRefs.stats} onScrolled={setScrolled}>
                <Suspense fallback={<AnalyticsSkeleton />}>
                  <Analytics txs={txs} month={month} active={tab === 'stats'} onMonth={setMonth} onCategory={openCategory} />
                </Suspense>
              </TabPanel>
            )}
            {visited.current.has('budgets') && (
              <TabPanel active={tab === 'budgets'} panelRef={panelRefs.budgets} onScrolled={setScrolled}>
                <Budgets data={data} txs={txs} month={month} onEdit={setBudgetFor} />
              </TabPanel>
            )}
          </>
        )}
      </main>

      <BottomNav tab={tab} onTab={switchTab} onAdd={() => setAdding(true)} />

      {data && (<>
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
      </>)}
      <Sheet open={settings} onClose={() => setSettings(false)} title="Настройки">
        <div className="mb-3 rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
          {conn.demo ? 'Сейчас показаны демо-данные.' : <>Подключено к таблице.<br /><span className="break-all text-ink-3">{conn.url}</span></>}
          {data && <div className="mt-2 text-ink-3">Обновлено: {new Date(data.generatedAt).toLocaleString('ru-RU')}</div>}
        </div>
        <button onClick={onLogout} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3.5 font-semibold text-critical">
          <LogOut size={18} /> {conn.demo ? 'Подключить свою таблицу' : 'Отключить'}
        </button>
      </Sheet>
      <Toast text={toast} />
    </div>
  );
}
