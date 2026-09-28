import type { AppData, Connection } from './types';
import { demoData, demoMutate } from './demo';

export class ApiError extends Error {}

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Google вернул HTML (страница входа/ошибки) — обычно не сделан Deploy → New version или доступ не «Anyone».
    throw new ApiError('Скрипт вернул не JSON. Проверь, что развёрнута новая версия и доступ — «Anyone».');
  }
}

export async function fetchData(c: Connection): Promise<AppData> {
  if (c.demo) return demoData();
  const url = new URL(c.url);
  url.searchParams.set('action', 'data');
  url.searchParams.set('token', c.token);
  const res = await fetch(url, { redirect: 'follow' });
  const body = await readJson(res);
  if (!body.ok) throw new ApiError(body.message?.replace(/^⚠️\s*/, '') || body.error || 'Ошибка скрипта');
  return body as AppData;
}

export interface PostResult { ok: boolean; message?: string; error?: string }

/**
 * POST в Apps Script. text/plain — «простой» запрос без CORS-preflight, который Apps Script не поддерживает.
 */
export async function post(c: Connection, payload: Record<string, unknown>): Promise<PostResult> {
  if (c.demo) return demoMutate(payload);
  const res = await fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, token: c.token }),
    redirect: 'follow'
  });
  const body = (await readJson(res)) as PostResult;
  if (!body.ok) throw new ApiError(body.message?.replace(/^⚠️\s*/, '') || body.error || 'Ошибка скрипта');
  return body;
}

export const setCategory = (c: Connection, id: number, merchant: string, category: string, remember: boolean) =>
  post(c, { action: 'setCategory', id, merchant, category, remember });

export const setBudget = (c: Connection, category: string, limit: number) =>
  post(c, { action: 'setBudget', category, limit });

export const addExpense = (c: Connection, amount: number, merchant: string, category: string) =>
  post(c, { amount, merchant, category, source: 'app', currency: 'KGS' });
