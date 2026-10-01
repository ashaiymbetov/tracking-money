import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileUp, ImageIcon, LogOut, RefreshCw, ScanFace, Settings } from 'lucide-react';
import clsx from 'clsx';
import { BottomNav, type Tab } from './components/BottomNav';
import { MonthSwitcher, Sheet, Toast } from './components/ui';
import { AddExpenseSheet, BudgetSheet, EditCategorySheet } from './components/sheets';
import { ImportSheet } from './components/ImportSheet';
import { LockScreen, useAutoLock } from './components/Lock';
import { Home } from './screens/Home';
import { Transactions } from './screens/Transactions';
import { Budgets } from './screens/Budgets';
import { Setup } from './screens/Setup';
import { AnalyticsSkeleton, BudgetsSkeleton, HomeSkeleton, ListSkeleton } from './components/Skeletons';
import { loadConnection, saveConnection } from './lib/config';
import { clearCache, useAddExpense, useData, useSetBudget, useSetCategory, useSetLogo } from './lib/queries';
import { LogosContext } from './lib/logoContext';
import { merchantsWithoutLogo } from './lib/logos';
import { findLogos } from './lib/api';
import { clearLock, disableLock, enableLock, faceIdAvailable, GRACE_OPTIONS, lockCredential, lockGrace, markSeen, setLockGrace, shouldLock, type Grace } from './lib/faceid';
import { countable, monthKey, shiftMonth, type MonthKey } from './lib/stats';
import { formatUpdated, pluralNew } from './lib/format';
import type { Connection, Transaction } from './lib/types';

// Recharts тяжёлый — грузим аналитику отдельным чанком, главная открывается сразу (а чанк подгружаем в фоне).
const loadAnalytics = () => import('./screens/Analytics');
const Analytics = lazy(() => loadAnalytics().then(m => ({ default: m.Analytics })));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Вкладка остаётся смонтированной после первого открытия (как в нативных приложениях):
 * переключение мгновенное, без пересоздания экрана; появление — дешёвая анимация на GPU.
 */
function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active || !ref.current || reducedMotion()) return;
    ref.current.animate(
      [{ opacity: 0, transform: 'translate3d(0, 8px, 0)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    );
  }, [active]);
  return <div ref={ref} hidden={!active}>{children}</div>;
}

const TITLES: Record<Tab, string> = { home: 'Обзор', list: 'Операции', stats: 'Аналитика', budgets: 'Бюджеты' };

export default function App() {
  const [conn, setConn] = useState<Connection | null>(() =>
    new URLSearchParams(location.search).has('demo') ? { url: '', token: '', demo: true } : loadConnection());

  const [lockOn, setLockOn] = useState(() => !!lockCredential());
  // iOS часто выгружает приложение из памяти — если открыл снова в пределах выбранного времени, Face ID не нужен.
  const [locked, setLocked] = useState(() => shouldLock());
  const lock = useCallback(() => setLocked(true), []);
  useAutoLock(lockOn && !!conn, locked, lock);

  const logout = () => { saveConnection(null); clearCache(); clearLock(); setLockOn(false); setLocked(false); setConn(null); };
  if (!conn) return <Setup onDone={c => { saveConnection(c); setConn(c); }} />;
  return (
    <>
      {/* Под замком приложение уже грузит свежие данные, но недоступно ни для касаний, ни для VoiceOver. */}
      <div inert={locked}>
        <Main conn={conn} onLogout={logout} lockOn={lockOn} onLockChange={setLockOn} />
      </div>
      {locked && <LockScreen onUnlock={() => { markSeen(); setLocked(false); }} onReset={logout} />}
    </>
  );
}

function Main({ conn, onLogout, lockOn, onLockChange }: {
  conn: Connection;
  onLogout: () => void;
  lockOn: boolean;
  onLockChange: (on: boolean) => void;
}) {
  const query = useData(conn);
  const data = query.data;
  const [tab, setTab] = useState<Tab>('home');
  const visited = useRef(new Set<Tab>(['home']));
  visited.current.add(tab);
  const scrollByTab = useRef<Partial<Record<Tab, number>>>({});
  const [scrolled, setScrolled] = useState(false);   // тонкая линия под шапкой, когда контент уехал под неё
  const [month, setMonth] = useState<MonthKey>(() => monthKey(new Date()));
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [adding, setAdding] = useState(false);
  const [budgetFor, setBudgetFor] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const setCategory = useSetCategory(conn);
  const setBudget = useSetBudget(conn);
  const addExpense = useAddExpense(conn);
  const setLogo = useSetLogo(conn);
  const [findingLogos, setFindingLogos] = useState(false);

  const notify = useCallback((t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); }, []);
  const onError = useCallback((e: Error) => notify(`⚠️ ${e.message}`), [notify]);

  // Прокручивается сама страница: только так iOS отдаёт веб-приложению полный экран
  // (у непрокручиваемой страницы окно укорачивается, и таб-бар «всплывает» над чёрной полосой).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // У каждой вкладки своя позиция прокрутки.
  useLayoutEffect(() => {
    window.scrollTo(0, scrollByTab.current[tab] ?? 0);
    setScrolled(window.scrollY > 4);
  }, [tab]);
  const switchTab = useCallback((t: Tab, keepFilter = false) => {
    if (t === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }   // повторное нажатие — наверх, как в iOS
    scrollByTab.current[tab] = window.scrollY;
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

  // «+1 новая операция», когда свежие данные принесли то, чего не было (свои ручные добавления не считаем).
  const knownIds = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.transactions.map(t => t.id));
    const prev = knownIds.current;
    knownIds.current = ids;
    if (!prev) return;
    const fresh = data.transactions.filter(t => !prev.has(t.id) && t.id > 0 && t.source !== 'app').length;
    if (fresh > 0 && fresh < 50) notify(pluralNew(fresh));
  }, [data, notify]);

  // «Обновлено N мин назад» — пересчитываем раз в 30 секунд.
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(id); }, []);
  const now = monthKey(new Date());
  const minMonth = shiftMonth(now, -12);

  const [canFaceId, setCanFaceId] = useState(false);
  useEffect(() => { faceIdAvailable().then(setCanFaceId); }, []);
  const [lockBusy, setLockBusy] = useState(false);
  const [grace, setGrace] = useState<Grace>(lockGrace);
  const toggleLock = async () => {
    setLockBusy(true);
    try {
      if (lockOn) { await disableLock(); onLockChange(false); notify('Face ID выключен'); }
      else { await enableLock(); onLockChange(true); notify('Face ID включён'); }
    } catch (e) {
      notify(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLockBusy(false);
    }
  };

  const noLogo = data ? merchantsWithoutLogo(data.transactions, data.logos) : [];
  const runFindLogos = async () => {
    setFindingLogos(true);
    try {
      const r = await findLogos(conn, noLogo);
      notify(r.message ?? 'Готово');
      query.refetch();
    } catch (e) {
      notify(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFindingLogos(false);
    }
  };

  return (
    <LogosContext.Provider value={data?.logos ?? []}>
    {/* Страница всегда чуть выше экрана — даже пока грузятся данные, иначе iOS укоротит окно. */}
    <div className="mx-auto max-w-lg" style={{ minHeight: 'calc(100lvh + 1px)' }}>
      <header className={clsx('pt-safe sticky top-0 z-20 bg-bg px-4 pb-2 transition-shadow duration-200',
        scrolled && 'shadow-[0_1px_0_var(--line)]')}>
        <div className="flex items-center justify-between pt-1">
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight">{TITLES[tab]}</h1>
            <div className="flex h-4 items-center gap-1.5 text-[12px] text-ink-3" aria-live="polite">
              {query.isFetching ? (
                <><RefreshCw size={11} className="animate-spin" /> Обновляю…</>
              ) : query.isError && data ? (
                <span className="text-critical">Не удалось обновить</span>
              ) : query.dataUpdatedAt > 0 ? (
                <>Обновлено {formatUpdated(query.dataUpdatedAt)}</>
              ) : null}
            </div>
          </div>
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

      <main className="px-4 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 104px)' }}>
        {!data ? (
          query.isError ? (
            <div className="mt-10 flex flex-col items-center gap-4 text-center">
              <p className="text-ink-2">⚠️ {(query.error as Error).message}</p>
              <button onClick={() => query.refetch()} className="rounded-2xl bg-accent px-5 py-3 font-semibold text-white">Повторить</button>
              <button onClick={onLogout} className="text-sm text-ink-3">Изменить подключение</button>
            </div>
          ) : tab === 'list' ? <ListSkeleton /> : tab === 'stats' ? <AnalyticsSkeleton /> : tab === 'budgets' ? <BudgetsSkeleton /> : <HomeSkeleton />
        ) : (
          <>
            <TabPanel active={tab === 'home'}>
              <Home data={data} txs={txs} month={month} onCategory={openCategory} onTx={setEditing}
                onAll={openAll} onBudgets={openBudgets} />
            </TabPanel>
            {visited.current.has('list') && (
              <TabPanel active={tab === 'list'}>
                <Transactions data={data} month={month} category={filter} onCategory={setFilter} onTx={setEditing} />
              </TabPanel>
            )}
            {visited.current.has('stats') && (
              <TabPanel active={tab === 'stats'}>
                <Suspense fallback={<AnalyticsSkeleton />}>
                  <Analytics txs={txs} month={month} active={tab === 'stats'} onMonth={setMonth} onCategory={openCategory} />
                </Suspense>
              </TabPanel>
            )}
            {visited.current.has('budgets') && (
              <TabPanel active={tab === 'budgets'}>
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
        onSaveLogo={site => {
          const t = editing!;
          setLogo.mutate({ merchant: t.merchant, site }, { onSuccess: () => notify(site ? 'Логотип сохранён' : 'Логотип убран'), onError });
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
        <button onClick={() => { setSettings(false); setImporting(true); }}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-accent py-3.5 font-semibold text-white">
          <FileUp size={18} /> Импорт выписки (PDF)
        </button>
        {!conn.demo && noLogo.length > 0 && (
          <>
            <button onClick={runFindLogos} disabled={findingLogos}
              className="mb-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3.5 font-semibold disabled:opacity-50">
              <ImageIcon size={18} /> {findingLogos ? 'Claude ищет сайты…' : `Найти логотипы (${noLogo.length} мест)`}
            </button>
            <p className="mb-3 text-center text-[12px] text-ink-3">Claude найдёт официальные сайты, иконки подтянутся с них. Разово, до ~40 ¢.</p>
          </>
        )}
        {(canFaceId || lockOn) && (
          <>
            <button onClick={toggleLock} disabled={lockBusy} role="switch" aria-checked={lockOn}
              className="mb-1 flex w-full items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-left disabled:opacity-60">
              <ScanFace size={20} className="shrink-0 text-accent" />
              <span className="flex-1 font-semibold">Вход по Face ID</span>
              <span className={clsx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200', lockOn ? 'bg-good' : 'bg-ink-3/40')}>
                <span className={clsx('absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-transform duration-200', lockOn && 'translate-x-5')} />
              </span>
            </button>
            {lockOn ? (
              <div className="mb-3 mt-2">
                <div className="mb-1.5 px-1 text-[13px] text-ink-3">Снова спрашивать, если не заходил</div>
                <div className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1">
                  {GRACE_OPTIONS.map(g => (
                    <button key={g} onClick={() => { setLockGrace(g); setGrace(g); }}
                      className={clsx('rounded-xl py-2 text-[14px] font-semibold transition-colors', grace === g ? 'bg-accent text-white' : 'text-ink-2')}>
                      {g === 0 ? 'Сразу' : g === 60 ? '1 час' : `${g} мин`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mb-3 text-center text-[12px] text-ink-3">Приложение будет открываться по лицу.</p>
            )}
          </>
        )}
        <button onClick={onLogout} className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3.5 font-semibold text-critical">
          <LogOut size={18} /> {conn.demo ? 'Подключить свою таблицу' : 'Отключить'}
        </button>
      </Sheet>
      <ImportSheet open={importing} conn={conn} onClose={() => setImporting(false)} onImported={() => query.refetch()} notify={notify} />
      <Toast text={toast} />
    </div>
    </LogosContext.Provider>
  );
}
