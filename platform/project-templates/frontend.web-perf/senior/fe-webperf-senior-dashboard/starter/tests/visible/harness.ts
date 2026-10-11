// PLATFORM-OWNED: вспомогательный код скрытых тестов платформы
import { act } from '@testing-library/react';
import { vi } from 'vitest';

import { createQueryCache } from '../../src/queryCache';

export interface Call {
  key: string;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export function makeHarness(ttlMs = 1000) {
  let t = 0;
  const calls: Call[] = [];
  const fetcher = vi.fn(
    (key: string) =>
      new Promise<unknown>((resolve, reject) => {
        calls.push({ key, resolve, reject });
      }),
  );
  const cache = createQueryCache({ fetcher, ttlMs, now: () => t });
  return {
    cache,
    fetcher,
    calls,
    tick: (ms: number) => {
      t += ms;
    },
    callsFor: (key: string) => calls.filter((c) => c.key === key),
  };
}

export const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

export const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

export const specs = () => [
  { id: 'revenue', title: 'Выручка', key: 'sales' },
  { id: 'orders', title: 'Заказы', key: 'sales' },
  { id: 'users', title: 'Пользователи', key: 'users' },
];

export function counter() {
  const counts: Record<string, number> = {};
  const onWidgetRender = (id: string) => {
    counts[id] = (counts[id] ?? 0) + 1;
  };
  return { counts, onWidgetRender, snapshot: () => ({ ...counts }) };
}
