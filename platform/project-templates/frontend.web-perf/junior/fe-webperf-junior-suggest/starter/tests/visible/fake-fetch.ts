// PLATFORM-OWNED: управляемый fetch для тестов платформы
import { vi } from 'vitest';

export interface FakeCall {
  url: string;
  query: string;
  signal: AbortSignal;
  respond: (items: string[]) => void;
  fail: (status?: number) => void;
  networkError: () => void;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/** Подменяет глобальный fetch. Каждый вызов ждёт решения теста. ignoreAbort – «плохой» fetch, не реагирующий на отмену. */
export function installFakeFetch(opts: { ignoreAbort?: boolean } = {}) {
  const calls: FakeCall[] = [];
  const fetchMock = vi.fn((input: unknown, init?: { signal?: AbortSignal }) => {
    const url = String(input);
    const signal = init?.signal as AbortSignal;
    return new Promise<FakeResponse>((resolve, reject) => {
      if (!opts.ignoreAbort) {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }
      calls.push({
        url,
        query: decodeURIComponent(url.split('?q=')[1] ?? ''),
        signal,
        respond: (items) => resolve({ ok: true, status: 200, json: async () => ({ items }) }),
        fail: (status = 500) => resolve({ ok: false, status, json: async () => ({}) }),
        networkError: () => reject(new TypeError('Failed to fetch')),
      });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock, queries: () => calls.map((c) => c.query), last: () => calls[calls.length - 1]! };
}
