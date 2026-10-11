<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: очередь фоновых задач с backpressure (Senior)

Node 20, TypeScript, без внешних зависимостей. Внутренний сервис принимает фоновые задачи быстрее, чем успевает их
выполнять; очередь должна защитить процесс от перегрузки, не терять принятые задачи и не выполнять одну и ту же
работу дважды. Время приходит только через инъектируемый `scheduler`: напрямую `setTimeout`/`setInterval`/`Date.now`
в `src/queue.ts` не использовать.

## `src/queue.ts`

```ts
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export type Priority = 'high' | 'normal' | 'low';
export interface JobContext { attempt: number }            // номер попытки, с 1
export interface QueueOptions {
  capacity: number;                    // максимум задач, ожидающих запуска
  concurrency: number;                 // максимум одновременно выполняющихся
  maxAttempts: number;                 // всего попыток, включая первую
  backoffMs: (failedAttempts: number) => number;  // пауза перед следующей попыткой
  attemptTimeoutMs?: number;           // лимит одной попытки; не задан — без лимита
  scheduler: Scheduler;
}
export interface SubmitOptions { priority?: Priority; key?: string }   // priority по умолчанию 'normal'
export interface QueueStats {
  queued: number; running: number; retrying: number;
  succeeded: number; failed: number; rejected: number;
}
export interface JobQueue {
  submit<T>(job: (ctx: JobContext) => Promise<T>, options?: SubmitOptions): Promise<T>;
  stats(): QueueStats;
  idle(): Promise<void>;
}
export function createJobQueue(options: QueueOptions): JobQueue;

export class QueueFullError extends Error {}        // name === 'QueueFullError'
export class AttemptTimeoutError extends Error {}   // name === 'AttemptTimeoutError'
export class NonRetryableError extends Error {}     // name === 'NonRetryableError'
export class JobFailedError extends Error {         // name === 'JobFailedError'
  readonly attempts: number;                        // сколько попыток сделано
  readonly cause: unknown;                          // ошибка последней попытки
}
```

### Параметры

- `capacity`, `concurrency`, `maxAttempts` — целые ≥ 1, иначе `createJobQueue` бросает `RangeError`.
  `attemptTimeoutMs`, если задан, — положительное число, иначе `RangeError`.

### Приём и backpressure

- Если есть свободный слот (`running < concurrency`), `submit` запускает `job` **синхронно, внутри вызова**.
- Иначе задача ждёт в очереди. Если в ожидании уже `capacity` задач, `submit` возвращает промис, отклонённый
  `QueueFullError`; `job` не вызывается, `rejected` растёт на 1. Принятая задача никогда не отбрасывается позже.
- Промис `submit` разрешается значением успешной попытки `job`.

### Порядок запуска

- Из ожидающих первой запускается задача с наивысшим приоритетом (`high` > `normal` > `low`); при равном приоритете —
  та, что была принята раньше (порядок вызовов `submit`).
- Освободившийся слот занимается сразу, как только попытка завершена, без таймеров и задержек.

### Ретраи

- Попытка неуспешна, если `job` отклонил промис, бросил исключение синхронно или превысил `attemptTimeoutMs`
  (тогда причина — `AttemptTimeoutError`, слот освобождается; поздний результат такой попытки игнорируется).
- Неуспешная попытка с номером `n < maxAttempts` не освобождает ничего, кроме слота: задача уходит в ожидание
  `backoffMs(n)` через `scheduler.setTimeout` и считается `retrying` (в `capacity` не входит). По истечении паузы
  она возвращается в очередь **со своим приоритетом и исходным порядком приёма** и не может быть отклонена.
- Ошибка `NonRetryableError` (экземпляр, брошенный или отклонённый `job`) завершает задачу сразу, без ретраев.
- Когда ретраи кончились (или ошибка не подлежит повтору), промис `submit` отклоняется `JobFailedError`:
  `attempts` — число сделанных попыток, `cause` — ошибка последней попытки; `failed` растёт на 1.
- Таймер таймаута попытки снимается через `clearTimeout`, когда попытка завершилась раньше.

### Идемпотентность

- `submit(job, { key })`: если задача с таким `key` ещё не завершена (ждёт, выполняется или в паузе ретрая),
  возвращается **тот же** промис, новый `job` не запоминается и не вызывается, `capacity` не расходуется,
  счётчики не меняются.
- Задача завершена (успех или окончательный отказ) — ключ свободен, результат не запоминается.
- Задача, отклонённая `QueueFullError`, ключ не занимает.

### Наблюдаемость и остановка

- `stats()`: `queued` — ждут слота, `running` — выполняются, `retrying` — в паузе ретрая; `succeeded`, `failed`,
  `rejected` — накопительные счётчики задач (дубликаты по ключу не считаются).
- `idle()` возвращает промис, который разрешается, когда `queued`, `running` и `retrying` равны нулю
  (уже так — разрешённый промис). Он никогда не отклоняется.

## `DESIGN.md` (в корне репозитория)

Разделы `## Решения`, `## Компромиссы`, `## Границы применимости` — в каждом не меньше 200 символов: почему
выбран именно такой отказ при переполнении и порядок запуска, что происходит с задачами при падении процесса и что
тогда нужно хранить вне памяти, как это поведёт себя на нескольких экземплярах сервиса и что изменится, если
задачи станут долгими или их станет в тысячу раз больше. Документ — материал для защиты проекта.
