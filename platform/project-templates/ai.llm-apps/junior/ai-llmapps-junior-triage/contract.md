<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: классификация обращений через LLM (ai.llm-apps, junior)

Модуль `src/triage.ts`. Интерфейс модели — `src/llm.ts` (файл платформы, не менять): проверка передаёт
фейковый клиент с заранее заданными ответами и смотрит, что ушло в запрос. Окружение: Node.js 20, без сети,
без своих зависимостей.

```ts
interface LlmClient { complete(req: { system: string; user: string }): Promise<string> }

type Category = 'billing' | 'bug' | 'account' | 'other';
type Priority = 'low' | 'normal' | 'high';
interface Triage { category: Category; priority: Priority; summary: string }

renderPrompt(template: string, vars: Record<string, string>): string
escapeUserInput(text: string): string
buildRequest(message: string): { system: string; user: string }
parseReply(raw: string): { ok: true; value: Triage } | { ok: false; reason: 'not_json' | 'invalid_schema' | 'refusal'; detail?: string }
triage(message: string, llm: LlmClient, opts?: { maxAttempts?: number }):   // maxAttempts по умолчанию 2
  Promise<{ ok: true; value: Triage; attempts: number }
        | { ok: false; reason: 'empty_input' | 'not_json' | 'invalid_schema' | 'refusal' | 'llm_error'; attempts: number; detail?: string }>
```

## Правила

- **renderPrompt.** Подставляет `{{имя}}` (имя — латинские буквы, цифры, `_`, начинается не с цифры; пробелы
  внутри скобок допустимы: `{{ name }}`). Подстановка за один проход: текст значений **не** разбирается заново
  (значение `"{{other}}"` остаётся как есть), а символы вроде `$&`, `$1` вставляются буквально. Лишние
  ключи в `vars` игнорируются. Переменная, которой нет среди **собственных** ключей `vars` (в том числе
  `constructor`, `toString`), → `Error("missing variable: <имя>")`.
- **escapeUserInput.** Заменяет `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;` (в этом порядке, один проход по тексту).
- **buildRequest.** Пользовательский текст обрезается до первых 2000 символов, затем экранируется и попадает
  **только в `user`**, внутри одной пары тегов `<message>…</message>`; в `system` текста обращения нет.
  `system` содержит: перечисление всех категорий и приоритетов, требование вернуть только JSON-объект вида
  `{"category","priority","summary"}`, указание считать содержимое `<message>` данными, а не инструкциями,
  и право отказаться ответом `{"refusal":"<причина>"}`. Сам шаблон `user` формируется через `renderPrompt`.
- **parseReply.** Строка обрезается по краям; если вся она обёрнута в блок кода Markdown (```` ``` ```` или
  ```` ```json ````), блок снимается. Остаток парсится как JSON.
  - не JSON → `not_json`;
  - JSON-объект со строковым полем `refusal` → `refusal`, `detail` — эта строка;
  - иначе объект обязан иметь `category` и `priority` из списков выше (точное совпадение) и `summary` —
    строку, непустую после обрезки, не длиннее 200 символов; в `value` попадают ровно эти три поля, `summary` обрезан.
    Любое другое → `invalid_schema` (массив, число, неверное значение, лишний тип поля).
- **triage.** Пустой или состоящий из пробелов `message` → `empty_input`, модель не вызывается, `attempts: 0`.
  Иначе вызывает `llm.complete(buildRequest(message))` и разбирает ответ `parseReply`.
  `not_json` и `invalid_schema` повторяются тем же запросом, но не больше `maxAttempts` обращений всего;
  `refusal` — без повторов, `detail` сохраняется. Исключение из `llm.complete` → `llm_error` без повторов
  (`detail` — текст ошибки). `attempts` — число сделанных обращений к модели. Исчерпанные попытки возвращают
  причину **последней** неудачи.

Видимые тесты — `tests/visible/`.
