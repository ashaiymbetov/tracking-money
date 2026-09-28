import type { Connection } from './types';

const KEY = 'tm.connection';

export function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Connection;
    return c.demo || (c.url && c.token) ? c : null;
  } catch {
    return null;
  }
}

export function saveConnection(c: Connection | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // приватный режим Safari — просто не запоминаем
  }
}
