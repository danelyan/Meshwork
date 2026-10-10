<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: API заказов (backend.web-api, middle)

Модуль `src/app.ts` экспортирует `createApp(db?: Db)` → приложение Express 5 или обработчик `node:http`.
Порт не открывать. Хранилище — асинхронное `Db` из `src/db.ts` (файл платформы, не менять): как у
настоящей БД, между вызовами проходит время, и параллельные запросы чередуются. Без аргумента —
`createDb()`, пустое хранилище. Проверка передаёт свою реализацию `Db` с задержками. Окружение
проверки: Node.js 20, `express` 5, без сети и без установки зависимостей.

## Заказ

```json
{ "id": "string", "customerId": "string", "items": [{ "sku": "string", "qty": 1, "priceKop": 1000 }],
  "totalKop": 1000, "status": "new | paid | shipped | cancelled", "version": 1, "createdAt": "ISO-8601" }
```

## Маршруты

| Метод и путь | Успех | Ошибки |
| --- | --- | --- |
| `POST /orders` + заголовок `Idempotency-Key` | `201` заказ, `status: "new"`, `version: 1`, `totalKop = Σ qty·priceKop` | `400 {"error":"idempotency_key_required"}`; `400 {"error":"validation","fields":[...]}`; `422 {"error":"idempotency_mismatch"}` |
| `GET /orders?limit=&cursor=&status=` | `200 {"items":[...],"nextCursor": string \| null}` | `400 {"error":"validation","fields":["limit"]}`; `400 {"error":"invalid_cursor"}` |
| `GET /orders/:id` | `200` заказ + заголовок `ETag: "<version>"` | `404 {"error":"not_found"}` |
| `PATCH /orders/:id` `{status}` + `If-Match: "<version>"` | `200` заказ, `version` +1, новый `ETag` | `428 {"error":"precondition_required"}`; `412 {"error":"version_conflict"}`; `409 {"error":"invalid_transition"}`; `400 validation`; `404` |

## Правила

- **Идемпотентность.** `Idempotency-Key` — 1…64 символа `[A-Za-z0-9_-]`. Повтор с тем же ключом и тем же
  телом (сравнение по содержимому JSON, порядок ключей не важен) возвращает тот же статус и тело,
  что первый ответ, с заголовком `Idempotent-Replayed: true`, и не создаёт второй заказ — в том числе
  когда повторы приходят **одновременно**. Тот же ключ с другим телом — `422`.
- **Валидация** (`fields` — имена неверных полей по алфавиту): `customerId` — непустая строка;
  `items` — массив 1…50 позиций, в каждой `sku` — непустая строка, `qty` — целое 1…100, `priceKop` — целое ≥ 0.
  Неверная позиция — поле `items`. Тело не объект — `fields: []`.
- **Пагинация.** Порядок — по времени создания, при равенстве — по `id`. `limit` — целое 1…100, по умолчанию 20.
  `nextCursor` непрозрачен для клиента; `null` — страниц больше нет. Заказы, созданные между запросами
  страниц, не приводят к дублям и пропускам уже существовавших заказов. `status` — фильтр по статусу.
  Курсор, который сервер не выдавал (испорчен), — `400 invalid_cursor`.
- **Версии.** `If-Match` принимается в кавычках и без. Нет заголовка — `428`; версия не текущая — `412`.
- **Статусы:** `new → paid`, `new → cancelled`, `paid → shipped`, `paid → cancelled`. Остальные переходы —
  `409 invalid_transition` (версия не меняется). Неизвестный статус — `400 validation` с `fields: ["status"]`.
- Все ответы — JSON. Неизвестный путь — `404 {"error":"not_found"}`.

Видимые тесты — `tests/visible/`. Платформа проверяет решение своим набором тестов по этому контракту.
