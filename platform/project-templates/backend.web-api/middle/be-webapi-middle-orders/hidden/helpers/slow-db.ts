// PLATFORM-OWNED: Db с задержками для скрытых тестов (параллельные запросы чередуются).
import type { Db } from '../../src/db';

export function slowDb(): Db & { writes: number } {
  const data = new Map<string, Map<string, unknown>>();
  let n = 0;
  const pause = () => new Promise<void>((r) => setTimeout(r, (n++ * 7) % 4));
  const col = (name: string) => {
    let c = data.get(name);
    if (!c) data.set(name, (c = new Map()));
    return c;
  };
  const db = {
    writes: 0,
    async get<T>(collection: string, id: string) {
      await pause();
      return structuredClone(col(collection).get(id)) as T | undefined;
    },
    async put<T>(collection: string, id: string, value: T) {
      await pause();
      db.writes++;
      col(collection).set(id, structuredClone(value));
    },
    async list<T>(collection: string) {
      await pause();
      return [...col(collection).values()].map((v) => structuredClone(v)) as T[];
    },
  };
  return db;
}
