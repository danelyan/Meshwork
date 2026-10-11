<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: цикл вызова инструментов моделью (Middle)

Node 20, TypeScript, без SDK моделей: модель передаётся снаружи как `Model` (`src/model.ts`, файл платформы – не меняйте).
Модель на каждом шаге либо просит вызвать инструмент, либо отдаёт итоговый ответ. Нужны реестр инструментов
с проверкой аргументов и цикл, который исполняет вызовы, возвращает модели результаты и ошибки и ведёт журнал.

## `src/model.ts` (файл платформы)

```ts
export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; toolCall: { id: string; name: string; args: unknown } }
  | { role: 'tool'; toolCallId: string; name: string; content: string };
export type ModelStep =
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'final'; text: string };
export interface ToolInfo { name: string; description: string; parameters: Record<string, { type: 'string' | 'number' | 'boolean'; required: boolean }> }
export interface Model { next(messages: Message[], tools: ToolInfo[]): Promise<ModelStep> }
```

## `src/agent.ts`

```ts
import type { Model, ToolInfo } from './model';
export interface ToolSpec extends ToolInfo { run(args: Record<string, unknown>): unknown | Promise<unknown> }
export type ToolErrorCode = 'unknown_tool' | 'invalid_arguments' | 'tool_error';
export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: { code: ToolErrorCode; message: string } };
export interface ToolRegistry { list(): ToolInfo[]; call(name: string, args: unknown): Promise<ToolOutcome> }
export function createRegistry(tools: ToolSpec[]): ToolRegistry;

export interface StepLog { step: number; tool: string; args: unknown; ok: boolean; result?: unknown; error?: { code: ToolErrorCode; message: string } }
export interface AgentResult { answer: string; steps: StepLog[]; modelCalls: number }
export type AgentErrorCode = 'bad_request' | 'step_limit' | 'bad_model_output' | 'model_failed';
export class AgentError extends Error { readonly code: AgentErrorCode; readonly steps: StepLog[] }
export function runAgent(options: { model: Model; registry: ToolRegistry; prompt: string; maxSteps?: number }): Promise<AgentResult>;
```

### Реестр
- `createRegistry` бросает обычный `Error`, если имя инструмента не соответствует `^[a-z][a-z0-9_]*$` или повторяется.
- `list()` – `ToolInfo` (без `run`) в порядке регистрации.
- `call` **никогда не бросает исключение** и не вызывает `run` при ошибке проверки:
  - нет такого инструмента – `unknown_tool`;
  - `args` не объект (`null`, массив, примитив), есть аргумент, которого нет в `parameters`, обязательный аргумент
    отсутствует (`undefined`), значение не того типа (`number` – только конечное число; `null` не подходит ни к какому типу) –
    `invalid_arguments`; сообщение содержит имя аргумента;
  - `run` бросил исключение или вернул отклонённый промис – `tool_error`, `message` равен `error.message` исходной ошибки;
  - результат нельзя сериализовать в JSON (например, цикл в объекте) – `tool_error`;
  - иначе `{ ok: true, result }` – значение, которое вернул `run` (промис дожидается).

### Цикл `runAgent`
- Проверка до обращения к модели: `prompt` пустой после `trim`; `maxSteps` задан и не целое число ≥ 1 – `AgentError('bad_request')`.
  `maxSteps` по умолчанию 6 – это максимум **обращений к модели**.
- Первый вызов `model.next` получает `[{ role: 'user', content: prompt }]` и `registry.list()`. Каждый следующий – историю целиком.
- `final` – завершение: `{ answer: text, steps, modelCalls }`.
- `tool_call` (если это не последнее допустимое обращение): в историю добавляется `{ role: 'assistant', toolCall: { id, name, args } }`,
  затем вызывается `registry.call`, и в историю добавляется `{ role: 'tool', toolCallId: id, name, content }`, где `content` –
  `JSON.stringify({ result })` при успехе (`result: undefined` записывается как `null`) или
  `JSON.stringify({ error: { code, message } })` при ошибке. Ошибка инструмента **не** прерывает цикл: её читает модель.
- В журнал на каждый исполненный вызов – `StepLog`: `step` – номер обращения к модели, породившего вызов (с 1), `tool`, `args`
  как пришли от модели, `ok`; при успехе `result`, при ошибке `error`.
- Если на `maxSteps`-м обращении модель снова просит инструмент, а не отвечает – `AgentError('step_limit')`; этот вызов **не**
  исполняется и в журнал не попадает. `AgentError.steps` – журнал на этот момент (так же и для остальных кодов).
- `model.next` бросил исключение или вернул отклонённый промис – `AgentError('model_failed')`, исходная ошибка в `cause`.
- Шаг модели неправильной формы (неизвестный `type`; у `tool_call` `id` или `name` не непустая строка; у `final` `text` не строка) –
  `AgentError('bad_model_output')`.
