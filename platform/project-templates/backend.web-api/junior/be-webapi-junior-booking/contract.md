<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: REST API записи на приём (backend.web-api, junior)

Модуль `src/app.ts` (ES-модуль) экспортирует `createApp()`. Функция возвращает приложение Express 5
или обработчик `(req, res) => void` для `node:http`. Порт не открывать: его открывает тест.
Данные — в памяти; каждый вызов `createApp()` начинает с пустого хранилища.

Окружение проверки: Node.js 20, TypeScript без проверки типов (vitest), сети наружу нет. Доступны
встроенные модули Node.js и `express` 5; свои зависимости не устанавливаются.

## Запись

```json
{ "id": "string", "clientName": "string", "specialistId": "string",
  "startsAt": "ISO-8601 UTC, как Date#toISOString()", "durationMin": 30, "status": "booked | cancelled" }
```

## Маршруты

| Метод и путь | Успех | Ошибки |
| --- | --- | --- |
| `POST /appointments` `{clientName, specialistId, startsAt, durationMin}` | `201` запись, `status: "booked"` | `400 {"error":"validation","fields":[...]}`; `409 {"error":"slot_taken"}` |
| `GET /appointments/:id` | `200` запись | `404 {"error":"not_found"}` |
| `GET /appointments?specialistId=&date=YYYY-MM-DD` | `200 {"items":[...]}` — записи специалиста (и даты по UTC, если задана), по возрастанию `startsAt`, отменённые тоже | `400 {"error":"validation","fields":["specialistId"]}` или `["date"]` |
| `POST /appointments/:id/cancel` | `200` запись со `status: "cancelled"` | `404`; `409 {"error":"already_cancelled"}` |

## Правила

- `clientName` — строка, после обрезки пробелов 1…100 символов; сохраняется обрезанной.
- `specialistId` — непустая строка.
- `startsAt` — строка даты-времени с часовым поясом (`Z` или `+03:00`); в ответе — `toISOString()`.
- `durationMin` — целое 15…240, кратное 15.
- `fields` — имена всех неверных полей, по алфавиту. Тело не JSON или не объект — `400` с `fields: []`.
- Слот занят, если у того же специалиста есть **не отменённая** запись и интервалы `[начало, конец)`
  пересекаются. Стык (одна кончается в 10:30, другая начинается в 10:30) — не пересечение.
- Все ответы — JSON. Неизвестный путь — `404 {"error":"not_found"}`.

Видимые тесты — `tests/visible/` (`npx vitest run tests/visible`). Платформа проверяет решение своим
набором тестов по этому контракту, включая случаи, которых нет в видимых.
