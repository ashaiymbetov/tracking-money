import { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Wallet } from 'lucide-react';
import { fetchData } from '../lib/api';
import type { Connection } from '../lib/types';

export function Setup({ initial, onDone }: { initial?: Connection | null; onDone: (c: Connection) => void }) {
  const [url, setUrl] = useState(initial?.demo ? '' : initial?.url ?? '');
  const [token, setToken] = useState(initial?.demo ? '' : initial?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const c = { url: url.trim(), token: token.trim() };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(c.url)) {
      setError('Ссылка должна выглядеть так: https://script.google.com/macros/s/…/exec');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetchData(c);
      onDone(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded-2xl bg-surface px-4 py-3.5 outline-none placeholder:text-ink-3 ring-accent focus:ring-2';
  return (
    <div className="pt-safe mx-auto flex min-h-full max-w-lg flex-col px-5 pb-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-14 mb-8">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] text-white shadow-lg"
          style={{ background: 'linear-gradient(135deg, var(--hero-from), var(--hero-to))' }}>
          <Wallet size={32} />
        </div>
        <h1 className="text-[32px] font-bold leading-tight tracking-tight">Расходы</h1>
        <p className="mt-2 text-[15px] text-ink-2">Подключи свою Google-таблицу: вставь URL веб-приложения Apps Script и токен из <code className="rounded bg-surface-2 px-1">setup()</code>.</p>
      </motion.div>

      <div className="space-y-3">
        <input className={field} placeholder="https://script.google.com/macros/s/…/exec" value={url}
          onChange={e => setUrl(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" />
        <input className={field} placeholder="Токен" value={token} onChange={e => setToken(e.target.value)}
          autoCapitalize="off" autoCorrect="off" spellCheck={false} type="password" />
        {error && <p className="rounded-2xl bg-critical/10 px-4 py-3 text-sm text-critical">⚠️ {error}</p>}
        <button disabled={busy || !url || !token} onClick={connect}
          className="w-full rounded-2xl bg-accent py-3.5 text-[16px] font-semibold text-white disabled:opacity-40 active:scale-[0.99] transition">
          {busy ? 'Проверяю…' : 'Подключить'}
        </button>
        <button onClick={() => onDone({ url: '', token: '', demo: true })}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-medium text-accent">
          <Sparkles size={16} /> Посмотреть на демо-данных
        </button>
      </div>

      <p className="mt-auto pt-10 text-center text-[12px] text-ink-3">
        Данные хранятся только в твоей Google-таблице. Приложение хранит URL и токен на этом устройстве.
      </p>
    </div>
  );
}
