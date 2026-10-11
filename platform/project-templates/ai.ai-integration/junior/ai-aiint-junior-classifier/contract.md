<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: классификатор обращений через LLM (Junior)

Node 20, TypeScript, без SDK моделей: модель передаётся снаружи как `Llm` (`src/llm.ts`, файл платформы — не меняйте).
Нужна функция, которая относит текст к одной из заданных меток, общаясь с моделью текстом и разбирая её JSON-ответ.

## `src/classify.ts`

```ts
import type { Llm } from './llm';
export interface ClassifyInput { text: string; labels: string[] }
export interface Classification { label: string; confidence: number; attempts: number }
export type ClassifyErrorCode = 'bad_request' | 'llm_failed' | 'invalid_output';
export class ClassifyError extends Error { readonly code: ClassifyErrorCode; readonly attempts: number }
export class ReplyError extends Error {}
export function buildPrompt(input: ClassifyInput): string;
export function parseReply(raw: string, labels: string[]): { label: string; confidence: number };
export function classify(llm: Llm, input: ClassifyInput, options?: { maxAttempts?: number }): Promise<Classification>;
```

### `buildPrompt`
Возвращает одну строку, в которой есть: текст обращения дословно (после `trim`), **каждая** метка и требование
ответить JSON-объектом с полями `label` и `confidence`. Точная формулировка свободная.

### `parseReply`
- Ответ модели может быть голым JSON, JSON в ограде ```json … ``` или JSON с текстом вокруг: берётся фрагмент от первой `{`
  до последней `}`. Нет такого фрагмента или он не разбирается как JSON-объект — `ReplyError`.
- `label` — строка, **точно** совпадающая с одной из `labels` (без приведения регистра и пробелов), иначе `ReplyError`.
- `confidence` — конечное число от 0 до 1 включительно (строка `"0.9"` не подходит), иначе `ReplyError`.
- Лишние ключи игнорируются. Сообщение `ReplyError` называет, что именно не так (поле и причина).

### `classify`
- Проверка входа до обращения к модели: `text` пустой после `trim`; меток меньше двух; метка не строка или пустая после `trim`;
  метки повторяются; `maxAttempts` задан и не целое число ≥ 1 — `ClassifyError('bad_request')`, модель не вызывается.
- Вызывает `llm.complete(prompt)`, первый prompt равен `buildPrompt(input)`. Разбирает ответ `parseReply`.
- Невалидный ответ — повтор, не более `maxAttempts` обращений к модели (по умолчанию 3). Prompt повтора — `buildPrompt(input)`,
  затем пустая строка и пояснение, содержащее **предыдущий ответ модели** и сообщение `ReplyError`.
- Успех: `{ label, confidence, attempts }`, где `attempts` — сколько раз вызвали модель.
- Все попытки невалидны — `ClassifyError('invalid_output')`, `attempts` = число сделанных обращений.
- Если `llm.complete` бросил исключение — повтор **не** делается: `ClassifyError('llm_failed')` с `attempts` = число обращений
  к этому моменту; исходная ошибка доступна как `cause`.
