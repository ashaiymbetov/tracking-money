/**
 * Safari на iOS 18 не умеет перебирать ReadableStream через `for await` (нет Symbol.asyncIterator),
 * а pdf.js этим пользуется (getTextContent, DecompressionStream). Добавляем недостающий метод —
 * и на странице, и в воркере pdf.js (см. pdf.worker.ts). Там, где он есть, ничего не трогаем.
 */
export function polyfillStreamIteration(scope: typeof globalThis = globalThis) {
  const RS = scope.ReadableStream as (typeof ReadableStream & { prototype: Record<symbol | string, unknown> }) | undefined;
  if (!RS || typeof RS.prototype[Symbol.asyncIterator] === 'function') return;

  async function* values(this: ReadableStream, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      if (!options?.preventCancel) reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  Object.defineProperty(RS.prototype, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, { value: values, writable: true, configurable: true });
}

polyfillStreamIteration();
