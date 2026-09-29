import type { AppData, Connection } from './types';
import { demoData, demoMutate } from './demo';
import type { StatementExpense } from './statement';

export class ApiError extends Error {}

/** Текст из HTML-ответа Google: заголовок и первые слова страницы — чтобы было понятно, что пошло не так. */
export function describeHtml(text: string): string {
  const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim();
  const body = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return [title, body].filter(Boolean).join(' — ') || text.slice(0, 160);
}

async function readJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Google вернул HTML: страница входа, ошибка скрипта или удалённое развёртывание.
    throw new ApiError(`Скрипт вернул не данные (HTTP ${res.status}): «${describeHtml(text)}». ` +
      'Проверь: Deploy → Manage deployments → New version, доступ «Anyone», и что URL заканчивается на /exec.');
  }
}

export async function fetchData(c: Connection): Promise<AppData> {
  if (c.demo) {
    // ?demo&slow — имитация медленной сети, чтобы посмотреть скелетоны.
    if (new URLSearchParams(location.search).has('slow')) await new Promise(r => setTimeout(r, 2500));
    return demoData();
  }
  const url = new URL(c.url);
  url.searchParams.set('action', 'data');
  url.searchParams.set('token', c.token);
  const res = await fetch(url, { redirect: 'follow' }).catch((e: unknown) => {
    throw new ApiError(`Нет связи со скриптом (${e instanceof Error ? e.message : e}). Проверь интернет и URL.`);
  });
  const body = await readJson(res);
  if (!body.ok) throw new ApiError(body.message?.replace(/^⚠️\s*/, '') || body.error || 'Ошибка скрипта');
  if (!Array.isArray(body.transactions)) {
    // Ответил старый doGet — код обновлён, но новая версия не развёрнута.
    throw new ApiError('Скрипт старой версии: вставь новый Code.gs и сделай Deploy → Manage deployments → ✏️ → New version.');
  }
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

export interface ImportResult extends PostResult { added?: number; duplicates?: number; uncategorized?: number }
export interface CategorizeResult extends PostResult { updated?: number; rules?: number }

export const importStatement = (c: Connection, bank: string, rows: StatementExpense[]) =>
  post(c, { action: 'import', bank, card: bank, rows }) as Promise<ImportResult>;

export const categorizeUnknown = (c: Connection) =>
  post(c, { action: 'categorizeUnknown' }) as Promise<CategorizeResult>;
