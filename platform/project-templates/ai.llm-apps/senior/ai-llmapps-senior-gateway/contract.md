<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: шлюз извлечения данных через LLM (Senior)

Node 20, TypeScript, без SDK моделей: провайдеры передаются снаружи (`src/provider.ts`, файл платформы —
не меняйте). Задача шлюза — надёжно получить из текста структурированные поля: несколько провайдеров,
бюджет токенов, кэш, проверка и «ремонт» ответа, персональные данные не уходят в модель.

## `src/gateway.ts`

```ts
import type { Provider } from './provider';
export interface Field { name: string; type: 'string' | 'number' | 'boolean'; required: boolean }
export interface ExtractRequest { instruction: string; text: string; fields: Field[] }
export type Value = string | number | boolean | null;
export interface ExtractResult { data: Record<string, Value>; provider: string; cached: boolean; repaired: boolean; tokens: number }
export type GatewayErrorCode = 'bad_request' | 'budget_exceeded' | 'provider_rejected' | 'all_providers_failed' | 'invalid_output';
export class GatewayError extends Error { readonly code: GatewayErrorCode }
export interface Gateway { extract(req: ExtractRequest): Promise<ExtractResult>; spent(): number }
export function createGateway(options: { providers: Provider[]; budgetTokens: number; maxTokens?: number }): Gateway;
```
`maxTokens` по умолчанию 512 — передаётся провайдеру как есть.

### Проверка запроса
`text` пустой (после trim), нет полей, имя поля не по шаблону `^[a-z][a-zA-Z0-9_]*$` или повторяется —
`GatewayError('bad_request')`, провайдер не вызывается.

### Персональные данные
- До отправки email и российские телефоны (`+7…` / `8…`, с пробелами, скобками, дефисами) в `text`
  заменяются плейсхолдерами `[EMAIL_1]`, `[EMAIL_2]`, `[PHONE_1]`… в порядке появления; одно и то же
  значение — один плейсхолдер. Провайдер не должен увидеть исходные значения ни в одном вызове.
- В строковых значениях результата плейсхолдеры заменяются обратно на исходные значения.

### Ответ модели
- Модель просят вернуть JSON-объект с полями из `fields`. Ответ может быть в ```json-ограде или с
  текстом вокруг — берётся объект от первой `{` до последней `}`.
- Проверка: каждое поле нужного типа (`number` — конечное число, строка с числом не подходит). Отсутствие
  или `null` у необязательного поля — `null` в результате, у обязательного — ошибка. Лишние ключи отбрасываются.
- Невалидный ответ (не JSON или не по полям) — **одна** повторная попытка у того же провайдера: в запросе
  прежний ответ и что именно не так. Удалось — `repaired: true`. Не удалось — `GatewayError('invalid_output')`.

### Провайдеры
- По порядку списка. `ProviderError` с `timeout`, `rate_limit`, `server` — переход к следующему провайдеру.
  Все упали так — `GatewayError('all_providers_failed')`.
- `ProviderError` с `bad_request` или `auth` — сразу `GatewayError('provider_rejected')`, без перехода к следующему.

### Бюджет
- `spent()` — сумма `inputTokens + outputTokens` всех ответов провайдеров (включая ремонт).
- Перед **каждым** вызовом провайдера: оценка = `ceil((system.length + user.length) / 4) + maxTokens`.
  Если `spent() + оценка > budgetTokens` — `GatewayError('budget_exceeded')`, вызова нет.
- `tokens` в результате — токены этого вызова `extract` (0 для ответа из кэша).

### Кэш
- Успешный результат кэшируется по `(instruction, text, fields)`: повтор — `cached: true`, `tokens: 0`, без вызова.
- Одновременные одинаковые запросы, пока первый ещё в работе, — один вызов провайдера на всех.
- Ошибки не кэшируются.

## `DESIGN.md` (в корне репозитория)
Разделы `## Решения`, `## Компромиссы`, `## Границы применимости` — в каждом не меньше 200 символов:
почему такой порядок фолбэка и ремонта, чем рискует маскирование ПДн (ложные срабатывания, утечки в
других полях), как бы ты мерил качество извлечения и где этот шлюз перестанет справляться.
