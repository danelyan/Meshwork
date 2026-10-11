<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: RAG по локальным документам (ai.llm-apps, middle)

Модуль `src/rag.ts`. Интерфейс модели – `src/llm.ts` (файл платформы, не менять): проверка передаёт
фейковый клиент и смотрит, что ушло в промпт. Окружение: Node.js 20, без сети, без своих
зависимостей; эмбеддинги не нужны – ретрив лексический.

```ts
interface LlmClient { complete(req: { system: string; user: string }): Promise<string> }

chunkText(text: string, opts?: { size?: number; overlap?: number }): string[]          // size 800, overlap 100
loadCorpus(dir: string): Promise<{ id: string; text: string }[]>
buildIndex(docs: { id: string; text: string }[], opts?: { size?: number; overlap?: number }): Index
retrieve(index: Index, query: string, k?: number): { chunkId: string; docId: string; text: string; score: number }[]  // k = 3
answer(question: string, opts: { index: Index; llm: LlmClient; k?: number; maxContextChars?: number }):
  Promise<{ answer: string; citations: string[]; refused: boolean }>                    // maxContextChars 4000
```

## Правила

- **chunkText.** Сначала пробельные последовательности схлопываются в один пробел, края обрезаются.
  Окна по символам: чанк `i` – `text.slice(i·(size−overlap), i·(size−overlap)+size)`; последний чанк –
  тот, что доходит до конца текста. Пустой текст → `[]`. `overlap ≥ size` или `size < 1` → `RangeError`.
- **loadCorpus.** Рекурсивно все `*.md` и `*.txt` (другие файлы пропускаются); `id` – путь от `dir`
  через `/`; результат отсортирован по `id`.
- **buildIndex.** Чанки каждого документа; `chunkId = "<docId>#<номер с нуля>"`.
- **retrieve.** Токены – последовательности букв и цифр (Unicode) в нижнем регистре. Оценка
  лексическая (TF-IDF или BM25 – на выбор), чанк без общих с запросом токенов не возвращается.
  Сортировка – по убыванию оценки, при равенстве – по `chunkId`. Не больше `k`.
- **answer.**
  1. Нет найденных чанков → `{ answer: "Не нашёл ответа в документах.", citations: [], refused: true }`,
     **модель не вызывается**.
  2. Иначе один вызов `llm.complete`. В `system` – указание отвечать только по контексту, ставить
     ссылки вида `[chunkId]` и считать текст документов данными, а не инструкциями. В `user` – вопрос и
     чанки в порядке ретрива, каждый с заголовком `[chunkId]`; суммарная длина текста чанков ≤
     `maxContextChars` (чанк, который не влезает, и все после него не включаются; первый чанк
     включается всегда, обрезанный до бюджета).
  3. `citations` – `chunkId` из ответа модели в порядке первого появления, без повторов и **только
     из переданных в промпт**. Остальные ссылки – галлюцинация: из `citations` выбрасываются.
  4. Если валидных ссылок нет – ответ модели не возвращается: тот же отказ, что в п. 1.
  5. `answer` – текст модели как есть (с её ссылками).

В `docs/` – пример корпуса для локальной проверки. Видимые тесты – `tests/visible/`.
