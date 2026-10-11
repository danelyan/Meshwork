<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: приём вебхука платёжного провайдера (backend.integrations, junior)

Модуль `src/webhook.ts` экспортирует `createApp(options)` (приложение Express) и `sign(secret, timestamp, rawBody)`.
Окружение: Node.js 20, Express 5, без сети и без своих зависимостей. Проверка вызывает `createApp` и ходит
в приложение через `supertest`; каждый вызов `createApp` – независимое состояние.

```ts
createApp(options: {
  secret: string,                          // общий секрет подписи
  now?: () => number,                      // текущее время в мс; по умолчанию Date.now
  toleranceSec?: number,                   // допустимое расхождение времени, по умолчанию 300
  onEvent?: (event: WebhookEvent) => void | Promise<void>,  // обработчик бизнес-логики
}): Express
sign(secret: string, timestamp: string, rawBody: string): string   // "sha256=<hex>"

interface WebhookEvent { id: string; type: string; data?: unknown }
```

## Запрос

`POST /webhooks/payments`, тело – JSON-объект `{"id","type","data"}`. Заголовки провайдера:

- `X-Timestamp` – целое число секунд Unix;
- `X-Signature` – `sha256=<hex>`, где hex – HMAC-SHA256 от строки `"<X-Timestamp>.<сырое тело>"` с ключом `secret`.

Подпись считается по **сырым байтам тела как они пришли** (пробелы, порядок ключей, юникод не нормализуются),
независимо от заголовка `content-type`. `sign` возвращает значение заголовка `X-Signature` для этих аргументов.

## Правила (проверяются по порядку)

1. Нет `X-Signature` или `X-Timestamp`, `X-Timestamp` не целое число, подпись неверного формата или не совпала →
   `401 {"error":"invalid_signature"}`. Сравнение подписей не должно падать на подписи другой длины.
2. Подпись верна, но `|now()/1000 − X-Timestamp| > toleranceSec` → `401 {"error":"stale_timestamp"}`
   (ровно `toleranceSec` – ещё допустимо). Проверка подписи идёт раньше проверки времени.
3. Тело не JSON, не объект, `id` или `type` не непустые строки → `400 {"error":"invalid_payload"}`.
4. Тип события вне набора `payment.succeeded`, `payment.failed`, `refund.created` → `200 {"status":"ignored"}`;
   `onEvent` не вызывается, событие не запоминается.
5. Событие с этим `id` уже было успешно обработано → `200 {"status":"duplicate"}`, `onEvent` не вызывается.
6. Иначе вызывается `onEvent(event)` с объектом `{ id, type, data }` (`data` – как пришло). Успех (в том числе
   асинхронный) → событие запоминается, `200 {"status":"processed"}`.
7. `onEvent` бросил ошибку или отклонил промис → `500 {"error":"handler_failed"}`, событие **не** запоминается:
   повторная доставка провайдера обработает его заново.

Если `onEvent` не передан, события просто принимаются по тем же правилам. Видимые тесты – `tests/visible/`.
