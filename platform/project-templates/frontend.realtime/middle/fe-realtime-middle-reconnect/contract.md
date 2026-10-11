<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: realtime-клиент с переподключением и чат с оптимистичной отправкой (Middle)

React 19, TypeScript, без сторонних библиотек. Настоящей сети нет: транспорт (WebSocket-подобный объект)
создаёт функция `connect`, которую передаёт тест. Таймеры – глобальные `setTimeout` / `clearTimeout`
(тесты подменяют их фейковыми). Две части независимы: тесты UI подставляют свой клиент, тесты клиента – свой транспорт.

## `src/client.ts`

```ts
export interface RealtimeTransport {
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}
export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';
export interface ServerEvent { id: number; type: string; data: unknown }

export interface RealtimeClientOptions {
  connect: (lastEventId: number | null) => RealtimeTransport;
  baseDelayMs?: number; // по умолчанию 1000
  maxDelayMs?: number;  // по умолчанию 30000
}
export interface RealtimeClient {
  start(): void;
  stop(): void;
  status(): ConnectionStatus;
  lastEventId(): number | null;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  onEvent(listener: (event: ServerEvent) => void): () => void;
}
export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient;
```

### Соединение
- До `start()` статус `closed`. `start()`: статус `connecting`, вызывается `connect(lastEventId)` (при первом запуске `null`),
  клиент назначает транспорту `onopen`, `onmessage`, `onclose`. Повторный `start()`, пока клиент не остановлен, ничего не делает.
- `onopen` транспорта – статус `open`.
- `onclose` текущего транспорта (в любой момент, в том числе до `onopen`) – статус `reconnecting`, через задержку
  вызывается `connect(lastEventId)` с актуальным `lastEventId`; статус остаётся `reconnecting`, пока не наступит `onopen`.
- Задержка – `min(baseDelayMs * 2^n, maxDelayMs)`, где `n` – число подряд неудачных попыток после последнего `onopen`
  (после первого обрыва `n = 0`). Каждый `onopen` обнуляет `n`. Без случайного разброса.
- `stop()`: статус `closed`, у текущего транспорта вызывается `close()`, отложенное переподключение отменяется.
  События и закрытия, пришедшие после этого, и события/закрытия любого транспорта, который уже не текущий, игнорируются.
  `lastEventId` сохраняется: после нового `start()` соединение запрашивает его, а `n` начинается с нуля.
  `stop()` на остановленном клиенте безвреден.
- Слушатели статуса вызываются при каждой смене статуса (повтор того же статуса не уведомляется).

### События
- Сообщение транспорта – JSON-строка вида `{"id": 12, "type": "message", "data": {…}}`. Некорректное
  (не JSON, не объект, `id` не конечное целое число, `type` не строка) молча игнорируется.
- Событие доставляется слушателям `onEvent` в порядке прихода, только если его `id` строго больше `lastEventId()`:
  повторы и перепроигрывание после переподключения отбрасываются, пропуски в нумерации допустимы.
  `lastEventId()` – `id` последнего доставленного события, до первого – `null`.
- Отписка (функция, которую вернули `onStatus` / `onEvent`) работает сразу.

## `src/ChatView.tsx`

```ts
export interface ChatViewProps {
  client: RealtimeClient;
  send: (clientId: string, text: string) => Promise<void>;
  makeId?: () => string; // идентификатор отправки; по умолчанию – любой уникальный
}
export function ChatView(props: ChatViewProps): JSX.Element;
```

`ChatView` сам не вызывает `start()` / `stop()`. Он читает `client.status()` при монтировании, подписывается на
`onStatus` и `onEvent` и отписывается при размонтировании.

### Разметка
- Статус – элемент `role="status"` с текстом: `open` – «Подключено», `connecting` – «Подключение…»,
  `reconnecting` – «Переподключение…», `closed` – «Отключено».
- Сообщения – пункты списка (`role="listitem"`) с текстом сообщения; у каждого атрибут `data-state`: `sent` или `pending`.
- Поле ввода с доступным именем «Сообщение» и кнопка «Отправить». Кнопка недоступна (`disabled`), пока статус не `open`.

### Сообщения
- Событие `type === 'message'` с `data` вида `{ text: string; clientId?: string }` добавляется в конец списка
  с `data-state="sent"`. События других типов и события с некорректной `data` на экран не попадают.
- Отправка (кнопка или submit формы): текст обрезается по краям; пустой – ничего не происходит; при статусе не `open`
  отправка игнорируется. Иначе: сгенерировать `clientId` (`makeId`), сразу показать сообщение с `data-state="pending"`
  в конце списка, очистить поле, вызвать `send(clientId, text)` один раз.
- Когда приходит событие `message` с `data.clientId` равным `clientId` ожидающего сообщения, ожидающее сообщение
  заменяется серверным (один пункт, `data-state="sent"`, на месте прихода события, текст – серверный).
  Завершение `send` успехом само по себе пункт не подтверждает – только событие сервера.
- Если `send` отклонён, а подтверждающее событие ещё не пришло: ожидающее сообщение убирается (откат), появляется
  элемент `role="alert"` с текстом «Не удалось отправить», а текст возвращается в поле, если оно пустое
  (если пользователь уже набирает другое – поле не трогать). Алерт исчезает при следующей успешной отправке
  (то есть при следующем принятом submit).
- Если `send` отклонён, но подтверждение уже пришло, – ничего не меняется (откатывать нечего).
