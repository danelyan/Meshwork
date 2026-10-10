<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: доставка вебхуков партнёру — outbox с ретраями и предохранителем (Senior)

Node 20, TypeScript, без внешних зависимостей. Сеть и часы передаются снаружи (`send`, `now`) — так
проверка управляет ответами партнёра и временем.

## `src/outbox.ts`

```ts
export interface OutboxEvent { id: string; key: string; payload: unknown }
export interface SendResult { status: number; retryAfterMs?: number }
export interface OutboxOptions {
  send: (event: OutboxEvent, attempt: number) => Promise<SendResult>; // исключение = сетевая ошибка
  now: () => number;                 // миллисекунды
  maxAttempts: number;               // всего попыток на событие, целое ≥ 1
  baseDelayMs: number;               // задержка после первой неудачи, ≥ 0
  maxDelayMs: number;                // потолок задержки, ≥ baseDelayMs
  breaker: { failureThreshold: number; cooldownMs: number }; // целое ≥ 1; ≥ 0
  concurrency?: number;              // одновременных отправок, целое ≥ 1, по умолчанию 4
}
export type BreakerState = 'closed' | 'open' | 'half_open';
export interface Outbox {
  enqueue(event: OutboxEvent): boolean;
  tick(): Promise<void>;
  stats(): { pending: number; delivered: number; dead: number; breaker: BreakerState };
  deadLetters(): { event: OutboxEvent; reason: string; attempts: number }[];
}
export function createOutbox(options: OutboxOptions): Outbox;
```

Неверные параметры — `RangeError`.

### Очередь
- `enqueue` возвращает `false` и ничего не ставит, если событие с таким `id` уже было (в очереди,
  доставлено или в dead letters). Новое событие готово к отправке сразу.
- **Порядок по ключу:** события одного `key` уходят строго по очереди. Следующее событие ключа не
  отправляется, пока предыдущее не доставлено или не ушло в dead letters. Разные ключи независимы.

### `tick()`
- Отправляет все готовые на момент начала `tick` события — по одному (первому в очереди) на ключ,
  в порядке постановки, не больше `concurrency` одновременно — и ждёт все ответы.
- В одном `tick` событие отправляется не больше одного раза, даже если задержка после неудачи нулевая.
- Повторный вызов `tick()`, пока предыдущий не завершён, возвращает тот же промис: двойных отправок нет.
- `send` получает номер попытки: 1, 2, …

### Ответы партнёра
- `2xx` — доставлено.
- `5xx`, `408`, `429` и исключение из `send` — временная ошибка: повтор. Задержка после `n`-й неудачной
  попытки — `min(maxDelayMs, baseDelayMs · 2^(n−1))`; у `429` с `retryAfterMs` — не меньше `retryAfterMs`.
  Событие снова готово через задержку от момента ответа. После `maxAttempts` попыток —
  dead letter с причиной `retries_exhausted`.
- Любой другой статус — постоянная ошибка: сразу dead letter с причиной `http_<статус>` (например `http_404`).

### Предохранитель (circuit breaker)
- Считает подряд идущие временные ошибки (по всем ключам). Достиг `failureThreshold` — `open`:
  новые отправки не начинаются (в том числе в текущем `tick`), `tick` ничего не шлёт.
- Через `cooldownMs` после открытия — `half_open`: `tick` отправляет ровно одно событие (первое готовое).
  Успех или постоянная ошибка (партнёр ответил) — `closed`; временная ошибка — снова `open` с новым отсчётом.
- Доставка и постоянная ошибка сбрасывают счётчик подряд идущих временных ошибок.
- `stats().breaker` показывает состояние на текущий момент `now()` (истёкший `open` — уже `half_open`).

## `DESIGN.md` (в корне репозитория)
Разделы `## Решения`, `## Компромиссы`, `## Границы применимости` — в каждом не меньше 200 символов:
почему так устроены ретраи и предохранитель, чем платим за порядок по ключу (head-of-line blocking),
что будет при рестарте процесса и нескольких экземплярах, где нужна идемпотентность у получателя.
