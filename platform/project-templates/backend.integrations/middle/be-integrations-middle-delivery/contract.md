<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: клиент API службы доставки (backend.integrations, middle)

Модуль `src/delivery-client.ts` экспортирует `createDeliveryClient(options)` и класс ошибки
`DeliveryError` (`src/errors.ts` — файл платформы, не менять). Клиент ходит в чужой HTTP API
глобальным `fetch` (Node.js 20). Проверка поднимает мок-сервер провайдера на `127.0.0.1` и передаёт
его адрес в `baseUrl`. Сети наружу нет, зависимости не устанавливаются.

```ts
createDeliveryClient({
  baseUrl: string,
  timeoutMs?: number,   // таймаут одной попытки, по умолчанию 2000
  maxRetries?: number,  // повторов после первой попытки, по умолчанию 3
  backoffMs?: number,   // база экспоненциальной паузы, по умолчанию 100
  sleep?: (ms: number) => Promise<void>, // пауза между попытками; по умолчанию setTimeout
}) => {
  quote(req: { fromCity: string; toCity: string; weightKg: number }): Promise<{ priceKop: number; etaDays: { min: number; max: number } }>;
  createShipment(req: { quoteId: string; recipient: string }, idempotencyKey: string): Promise<{ shipmentId: string; status: 'created' | 'pending' }>;
}
```

## API провайдера

| Запрос | Ответ провайдера |
| --- | --- |
| `POST {baseUrl}/v2/quotes` `{"from_city","to_city","weight_grams"}` | `200 {"quote_id","price":{"amount":"1234.50","currency":"RUB"},"eta":{"min_days":1,"max_days":3}}` |
| `POST {baseUrl}/v2/shipments` `{"quote_id","recipient"}` + заголовок `Idempotency-Key` | `201` или `200 {"shipment_id","status":"CREATED" \| "PENDING"}` |

## Правила

- `weight_grams = round(weightKg × 1000)`; `priceKop` — сумма в копейках без потери точности
  (`"1234.50"` → `123450`; разделитель — точка, не больше двух знаков после неё).
- Валюта не `RUB`, нет полей, сумма не по формату или `min_days > max_days` → `DeliveryError`
  с `code: "invalid_response"`, **без повторов**.
- Повторяются: сетевая ошибка, таймаут попытки, `429`, `5xx`. Пауза перед повтором `n` (с нуля) —
  `backoffMs × 2^n`; если у `429`/`503` есть `Retry-After` в секундах — ровно столько, но не больше 5000 мс.
- Попытки кончились → `DeliveryError` с `code: "unavailable"`, `attempts` = число сделанных попыток,
  `status` — HTTP-статус последнего ответа (если был).
- `400`/`422` → `code: "bad_request"`, `404` → `code: "not_found"`, без повторов; `status` — HTTP-статус.
- Все попытки `createShipment` идут с **одним и тем же** `Idempotency-Key` — тем, что передан.
- `status` провайдера `CREATED` → `created`, `PENDING` → `pending`.
- Каждый запрос — `content-type: application/json`.

Видимые тесты — `tests/visible/` (мок-сервер — `tests/visible/mock-provider.ts`).
