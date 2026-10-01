/**
 * Вход по Face ID через WebAuthn: при включении создаётся пароль-ключ (passkey) этого сайта в связке ключей
 * iCloud, а для разблокировки iOS проверяет лицо (или код телефона) и подписывает случайный запрос.
 * Сервера тут нет, поэтому это замок на экран приложения: чужой человек с разблокированным телефоном
 * не увидит расходы. Без Face ID доступ можно вернуть только заново подключив таблицу (URL + токен).
 */

const KEY = 'tm.faceid';
const GRACE_KEY = 'tm.faceid.grace';
const SEEN_KEY = 'tm.faceid.seen';

/** Сколько минут после ухода из приложения Face ID не спрашивать снова (0 — каждый раз). */
export const GRACE_OPTIONS = [0, 5, 30, 60] as const;
export type Grace = typeof GRACE_OPTIONS[number];
const DEFAULT_GRACE: Grace = 5;

export function lockGrace(): Grace {
  try {
    const v = Number(localStorage.getItem(GRACE_KEY));
    return (GRACE_OPTIONS as readonly number[]).includes(v) && localStorage.getItem(GRACE_KEY) !== null ? v as Grace : DEFAULT_GRACE;
  } catch {
    return DEFAULT_GRACE;
  }
}

export function setLockGrace(g: Grace) {
  try { localStorage.setItem(GRACE_KEY, String(g)); } catch { /* приватный режим */ }
}

/** «Каждый раз» — всё же с запасом в 10 секунд, чтобы не спрашивать из-за мелькнувшего системного окна. */
const graceMs = () => Math.max(lockGrace() * 60_000, 10_000);

/** Запоминаем, когда приложение ушло в фон: iOS часто выгружает его, и при новом запуске это уже «холодный старт». */
export function markSeen() {
  try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* приватный режим */ }
}

/** Нужно ли спрашивать Face ID, если из приложения ушли в момент `since` (по умолчанию — последний уход в фон). */
export function shouldLock(since?: number): boolean {
  if (!lockCredential()) return false;
  let t = since;
  if (t === undefined) {
    try { t = Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { t = 0; }
  }
  return !t || Date.now() - t > graceMs();
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export function lockCredential(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function clearLock() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(SEEN_KEY); } catch { /* приватный режим */ }
}

/** Есть ли на устройстве Face ID / Touch ID, доступный сайту. */
export async function faceIdAvailable(): Promise<boolean> {
  try {
    return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Флаг UV в authenticatorData: пользователь именно подтвердил личность (лицо, палец или код). */
const userVerified = (authData: ArrayBuffer) => (new Uint8Array(authData)[32] & 0x04) !== 0;

function explain(e: unknown): Error {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError') return new Error('Face ID отменён');
  if (name === 'InvalidStateError') return new Error('Ключ уже создан — попробуй ещё раз');
  return e instanceof Error ? e : new Error(String(e));
}

/** Включает замок. Вызывать прямо из нажатия: Safari показывает Face ID только в ответ на действие пользователя. */
export async function enableLock(): Promise<void> {
  let cred: PublicKeyCredential;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        challenge: random(32),
        rp: { name: 'Расходы' },
        user: { id: random(16), name: 'Расходы', displayName: 'Вход в приложение «Расходы»' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        attestation: 'none',
        timeout: 60_000
      }
    }) as PublicKeyCredential;
  } catch (e) {
    throw explain(e);
  }
  try { localStorage.setItem(KEY, toB64(cred.rawId)); } catch { throw new Error('Не удалось сохранить настройку'); }
}

/** Спрашивает Face ID. Бросает ошибку, если отменили или ключ не подошёл. */
export async function verify(): Promise<void> {
  const id = lockCredential();
  if (!id) return;
  let cred: PublicKeyCredential;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: fromB64(id), transports: ['internal', 'hybrid'] }],
        userVerification: 'required',
        timeout: 60_000
      }
    }) as PublicKeyCredential;
  } catch (e) {
    throw explain(e);
  }
  const res = cred.response as AuthenticatorAssertionResponse;
  if (toB64(cred.rawId) !== id || !userVerified(res.authenticatorData)) throw new Error('Не удалось подтвердить личность');
}

/** Выключает замок (после проверки Face ID) и просит iOS забыть ключ, если она это умеет. */
export async function disableLock(): Promise<void> {
  await verify();
  const id = lockCredential();
  clearLock();
  const signal = (PublicKeyCredential as unknown as { signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void> })
    .signalUnknownCredential;
  if (id && signal) signal.call(PublicKeyCredential, { rpId: location.hostname, credentialId: id }).catch(() => {});
}
