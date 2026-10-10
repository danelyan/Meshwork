<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: лимитер запросов публичного API (Senior)

Node 20, TypeScript, Express 5. Состояние — в памяти процесса. Время берётся только из переданной
функции `now()` (миллисекунды) — так проверка управляет часами.

## `src/limiter.ts`

```ts
export interface LimiterOptions { capacity: number; refillPerSec: number; maxKeys: number; now: () => number }
export interface Decision { allowed: boolean; limit: number; remaining: number; retryAfterMs: number; resetMs: number }
export interface Limiter { take(key: string, cost?: number): Decision; size(): number }
export function createLimiter(options: LimiterOptions): Limiter;
```

### `createLimiter(options)`
- Неверные параметры — `RangeError`: `capacity` и `maxKeys` — целые ≥ 1, `refillPerSec` > 0.
- Алгоритм — token bucket на каждый ключ. Новое ведро полное (`capacity` токенов). Токены пополняются
  непрерывно (дробно) со скоростью `refillPerSec`, но не выше `capacity`.
- Часы не идут назад: если `now()` меньше прошлого значения, считается, что прошло 0 мс.

### `take(key, cost = 1)`
- `cost` — целое ≥ 1, иначе `RangeError`. `cost > capacity` — тоже `RangeError`: такой запрос не пройдёт никогда.
- Если в ведре ≥ `cost` токенов — списать `cost`, `allowed: true`. Иначе `allowed: false`, **токены не списываются**.
- `limit` = `capacity`; `remaining` = целая часть (floor) токенов после решения.
- `retryAfterMs`: 0 при `allowed`; иначе — округлённое вверх число мс до момента, когда в ведре станет `cost` токенов.
- `resetMs`: округлённое вверх число мс до полного ведра после решения (0 — ведро полное).

### `size()` и память
- Хранится не больше `maxKeys` ключей. Новый ключ сверх лимита вытесняет ключ, к которому дольше всех не
  обращались (LRU; обращение — любой `take`).
- `take` — O(1) амортизированно: 100 000 разных ключей при `maxKeys = 10 000` обрабатываются за секунды, не минуты.

## `src/app.ts`

```ts
export function rateLimit(limiter: Limiter, opts: { key: (req: Request) => string | null; cost?: (req: Request) => number }): RequestHandler;
export function createApp(deps: { limiter: Limiter }): Express;
```

### `rateLimit` (middleware Express)
- `key(req)` вернул `null` — запрос проходит без лимита и без заголовков.
- На каждый лимитируемый ответ — заголовки `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset` (секунды, `ceil(resetMs / 1000)`).
- Отказ — `429`, заголовок `Retry-After` (секунды, `ceil(retryAfterMs / 1000)`, не меньше 1), тело
  `{ "error": "rate_limited", "retryAfterMs": <число> }`; дальше запрос не идёт.
- `cost` больше ёмкости — `400 { "error": "cost_exceeds_capacity" }`.

### Маршруты `createApp`
- Ключ лимита — заголовок `X-Api-Key`. Нет заголовка на `/api/*` — `401 { "error": "api_key_required" }` без лимита.
- `GET /api/items` — стоимость 1, `200 { "items": [] }`.
- `POST /api/reports` — тяжёлый запрос, стоимость 5, `202 { "queued": true }`.
- `GET /health` — `200 { "ok": true }`, без лимита и без заголовков лимита.

## `DESIGN.md` (в корне репозитория)
Разделы `## Решения`, `## Компромиссы`, `## Границы применимости` — в каждом не меньше 200 символов:
почему этот алгоритм, что теряется при вытеснении ключа, что изменится при нескольких экземплярах сервиса
и как бы ты это решал. Документ — материал для защиты проекта.
