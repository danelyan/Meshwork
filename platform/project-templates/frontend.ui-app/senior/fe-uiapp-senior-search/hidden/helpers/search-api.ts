// PLATFORM-OWNED: управляемый поиск для скрытых тестов
import type { Item } from '../../src/SearchBox';

export interface Call {
  query: string;
  signal: AbortSignal;
  resolve: (items: Item[]) => void;
  reject: (e: unknown) => void;
}

/** search, каждый вызов которого ждёт решения теста. Отмену намеренно игнорирует (как плохой API). */
export function controlledSearch() {
  const calls: Call[] = [];
  const search = (query: string, signal: AbortSignal) =>
    new Promise<Item[]>((resolve, reject) => {
      calls.push({ query, signal, resolve, reject });
    });
  return { search, calls, queries: () => calls.map((c) => c.query), last: () => calls[calls.length - 1]! };
}

export const items = (...titles: string[]): Item[] => titles.map((t, i) => ({ id: `${t}-${i}`, title: t }));
