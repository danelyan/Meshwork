<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: кеш перед медленным источником (Junior)

Node 20, TypeScript. Состояние – в памяти процесса. Время берётся только из переданной функции
`now()` (миллисекунды) – так проверка управляет часами. Своих таймеров (`setTimeout`/`setInterval`)
не заводить: просроченные записи удаляются лениво, при обращении.

## `src/cache.ts`

```ts
export interface CacheOptions { maxEntries: number; ttlMs: number; now: () => number }
export interface CacheStats { hits: number; misses: number; evictions: number; expirations: number; size: number; hitRate: number }
export interface Cache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  deleteByPrefix(prefix: string): number;
  clear(): void;
  size(): number;
  stats(): CacheStats;
}
export function createCache<V>(options: CacheOptions): Cache<V>;
```

### Параметры
- `maxEntries` – целое ≥ 1, `ttlMs` – число > 0 (конечное), иначе `RangeError`.
- `ttlMs` в `set` (необязательный) заменяет общий TTL для этой записи; значение ≤ 0 или не число – `RangeError`.

### Время жизни
- Запись, записанная в момент `t` с TTL `T`, жива при `now() < t + T`. В момент `t + T` и позже она истекла.
- Истекшая запись не возвращается и не считается присутствующей (`has` → `false`).

### `get(key)`
- Жива – вернуть значение, `hits` +1, запись становится «самой свежей» по использованию.
- Нет или истекла – вернуть `undefined`, `misses` +1. Истекшая запись при этом удаляется, `expirations` +1.
- Хранимое значение может быть любым, кроме `undefined`: `0`, `''`, `false`, `null` – обычные значения,
  `get` возвращает их как попадание.

### `set(key, value, ttlMs?)`
- `value === undefined` – `TypeError`.
- Перезапись существующего ключа заменяет значение и срок жизни, делает запись «самой свежей»;
  вытеснения не происходит, `evictions` и `expirations` не меняются (даже если старая запись уже истекла).
- Новый ключ при `size() === maxEntries`: сначала удаляются **все** истекшие записи (каждая – `expirations` +1);
  если место освободилось, живые записи не трогать. Иначе вытесняется запись, которой дольше всех
  не пользовались (LRU; пользование – успешный `get` или `set`), `evictions` +1.
- `has` не считается пользованием и не меняет статистику.

### Остальное
- `delete(key)` – `true`, если живая запись была удалена; для отсутствующей или истекшей – `false`.
  Статистику не меняет.
- `deleteByPrefix(prefix)` – удалить все записи, ключ которых начинается с `prefix` (в том числе истекшие),
  вернуть число удалённых **живых**. Статистику не меняет.
- `clear()` – удалить всё; счётчики статистики не обнуляются.
- `size()` – число живых записей; `size()` и `has()` не удаляют истекшие записи и не меняют статистику.
- `stats()` – `hitRate = hits / (hits + misses)`, при нуле обращений `0`; `size` равен `size()`.
  `expirations` – число истекших записей, найденных и удалённых при `get` или при освобождении места в `set`.

## `src/loader.ts`

```ts
export interface CachedLoaderOptions<V> { cache: Cache<V>; load: (key: string) => Promise<V> }
export interface CachedLoader<V> {
  get(key: string): Promise<V>;
  invalidate(key: string): boolean;
  invalidatePrefix(prefix: string): number;
}
export function createCachedLoader<V>(options: CachedLoaderOptions<V>): CachedLoader<V>;
```

- `get(key)`: ровно один `cache.get(key)`. Есть значение – вернуть, источник не вызывать.
  Нет – вызвать `load(key)`, положить результат в кеш (`cache.set`) и вернуть его.
- Ошибка `load` (отказ промиса или синхронное исключение) уходит вызывающему как отказ `get`,
  в кеш ничего не кладётся: следующий `get` снова обратится к источнику.
- `invalidate(key)` – как `cache.delete`; `invalidatePrefix(prefix)` – как `cache.deleteByPrefix`.
  После инвалидации следующий `get` идёт в источник.
- Объединять одновременные вызовы для одного ключа не требуется.
