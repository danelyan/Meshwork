// PLATFORM-OWNED: интерфейс хранилища (contract.md). Не меняйте: проверка передаёт свою реализацию.
export interface Db {
  get<T>(collection: string, id: string): Promise<T | undefined>;
  put<T>(collection: string, id: string, value: T): Promise<void>;
  /** Все записи коллекции в порядке первой вставки. */
  list<T>(collection: string): Promise<T[]>;
}

/** Хранилище в памяти: каждое обращение отдаёт управление циклу событий, как сетевой драйвер. */
export function createDb(): Db {
  const data = new Map<string, Map<string, unknown>>();
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const col = (name: string) => {
    let c = data.get(name);
    if (!c) data.set(name, (c = new Map()));
    return c;
  };
  return {
    async get<T>(collection: string, id: string) {
      await tick();
      return structuredClone(col(collection).get(id)) as T | undefined;
    },
    async put<T>(collection: string, id: string, value: T) {
      await tick();
      col(collection).set(id, structuredClone(value));
    },
    async list<T>(collection: string) {
      await tick();
      return [...col(collection).values()].map((v) => structuredClone(v)) as T[];
    },
  };
}
