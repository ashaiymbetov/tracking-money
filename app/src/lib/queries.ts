import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addExpense, fetchData, setBudget, setCategory, setLogo } from './api';
import type { AppData, Connection } from './types';

const CACHE_KEY = 'tm.cache';

function readCache(c: Connection): AppData | undefined {
  if (c.demo) return undefined;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as AppData) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(c: Connection, d: AppData) {
  if (c.demo) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* нет места/приватный режим */ }
}

export const clearCache = () => { try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ } };

export function useData(c: Connection) {
  return useQuery({
    queryKey: ['data', c.demo ? 'demo' : c.url],
    queryFn: async () => {
      const d = await fetchData(c);
      writeCache(c, d);
      return d;
    },
    initialData: () => readCache(c),
    initialDataUpdatedAt: 0, // кэш показываем сразу, но всё равно обновляем
    staleTime: 30_000,
    refetchOnWindowFocus: true
  });
}

function useOptimistic<V>(c: Connection, fn: (v: V) => Promise<unknown>, apply: (d: AppData, v: V) => AppData) {
  const qc = useQueryClient();
  const key = ['data', c.demo ? 'demo' : c.url];
  return useMutation({
    mutationFn: fn,
    onMutate: async (v: V) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AppData>(key);
      if (prev) qc.setQueryData<AppData>(key, apply(structuredClone(prev), v));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: key })
  });
}

export interface CategoryChange { id: number; merchant: string; category: string; remember: boolean }

export function useSetCategory(c: Connection) {
  return useOptimistic<CategoryChange>(
    c,
    v => setCategory(c, v.id, v.merchant, v.category, v.remember),
    (d, v) => {
      d.transactions.forEach(t => {
        if (t.id === v.id || (v.remember && t.merchant === v.merchant)) t.category = v.category;
      });
      return d;
    }
  );
}

export function useSetBudget(c: Connection) {
  return useOptimistic<{ category: string; limit: number }>(
    c,
    v => setBudget(c, v.category, v.limit),
    (d, v) => {
      if (v.limit > 0) d.budgets[v.category] = v.limit;
      else delete d.budgets[v.category];
      return d;
    }
  );
}

export function useSetLogo(c: Connection) {
  return useOptimistic<{ merchant: string; site: string }>(
    c,
    v => setLogo(c, v.merchant, v.site),
    (d, v) => {
      const pattern = v.merchant.toLowerCase();
      d.logos = (d.logos ?? []).filter(([k]) => k !== pattern);
      if (v.site.trim()) d.logos.unshift([pattern, v.site.trim()]);
      return d;
    }
  );
}

export function useAddExpense(c: Connection) {
  return useOptimistic<{ amount: number; merchant: string; category: string }>(
    c,
    v => addExpense(c, v.amount, v.merchant, v.category),
    (d, v) => {
      d.transactions.push({
        id: -Date.now(), date: new Date().toISOString(), amount: v.amount, currency: d.currency,
        merchant: v.merchant || 'Без названия', category: v.category, card: '', source: 'app'
      });
      return d;
    }
  );
}
