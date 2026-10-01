import { useCallback, useEffect, useRef, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { LOCK_GRACE_MS, verify } from '../lib/faceid';

/**
 * Запирает приложение, когда его вернули из фона позже чем через минуту.
 * Пока приложение в фоне, экран закрыт заглушкой — чтобы расходов не было видно в переключателе приложений.
 */
export function useAutoLock(enabled: boolean, lock: () => void) {
  useEffect(() => {
    if (!enabled) return;
    let hiddenAt = 0;
    const root = document.documentElement;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        root.classList.add('privacy');
      } else {
        root.classList.remove('privacy');
        if (hiddenAt && Date.now() - hiddenAt > LOCK_GRACE_MS) lock();
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); root.classList.remove('privacy'); };
  }, [enabled, lock]);
}

export function LockScreen({ onUnlock, onReset }: { onUnlock: () => void; onReset: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  const unlock = useCallback(async (auto: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await verify();
      onUnlock();
    } catch (e) {
      // Автозапуск Safari может не пустить без нажатия — тогда молча ждём кнопку.
      if (!auto) setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [onUnlock]);

  // Сразу показываем Face ID при открытии и при возвращении в приложение.
  useEffect(() => {
    if (!document.hidden) unlock(true);
    const onVisibility = () => { if (!document.hidden) unlock(true); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [unlock]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg px-8 text-center" role="dialog" aria-label="Приложение заблокировано">
      <button onClick={() => unlock(false)} disabled={busy} aria-label="Разблокировать"
        className="mb-5 flex h-24 w-24 items-center justify-center rounded-[28px] bg-accent/12 text-accent transition active:scale-95">
        <ScanFace size={52} strokeWidth={1.5} />
      </button>
      <h1 className="text-[22px] font-bold">Расходы заблокированы</h1>
      <p className="mt-1 text-[15px] text-ink-2">Посмотри на телефон, чтобы открыть</p>
      <button onClick={() => unlock(false)} disabled={busy}
        className="mt-8 w-full max-w-xs rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-white transition active:scale-[0.99] disabled:opacity-50">
        {busy ? 'Проверяю…' : 'Открыть с Face ID'}
      </button>
      <p className="mt-3 h-5 text-sm text-critical" aria-live="polite">{error}</p>
      <button
        onClick={() => {
          if (confirm('Отключить приложение от таблицы? Данные в таблице останутся, но нужно будет заново вставить ссылку и токен.')) onReset();
        }}
        className="pb-safe absolute bottom-6 text-[13px] text-ink-3">
        Face ID не работает? Подключиться заново
      </button>
    </div>
  );
}
