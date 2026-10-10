<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: ETL заказов CSV → SQLite (engineering.data-eng, junior)

Модуль `etl.py` в корне репозитория. Окружение: Python 3.12, только стандартная библиотека
(`csv`, `sqlite3`, `decimal`, `datetime`, `re`), без сети. Проверка — pytest (тесты в стиле `unittest` тоже идут).

```python
def run(csv_path: str, db_path: str) -> dict:  # {"read", "loaded", "rejected", "duplicates"}
```

`python etl.py input.csv output.db` — то же из командной строки, печатает отчёт одной строкой JSON.

## Вход

CSV в UTF-8 (возможен BOM), разделитель — запятая, первая строка — заголовок с колонками
`order_id, customer_email, amount, currency, created_at` (порядок любой, лишние колонки игнорируются).
Нет обязательной колонки → `ValueError("missing column: <имя>")`, база не меняется.

## Правила строки (проверяются по порядку; первая ошибка — причина отбраковки)

| Поле | Правило | Код причины |
| --- | --- | --- |
| `order_id` | непустой после обрезки пробелов | `missing_order_id` |
| `customer_email` | обрезать, в нижний регистр; `^[^@\s]+@[^@\s]+\.[^@\s]+$` | `invalid_email` |
| `amount` | десятичное, разделитель `.` или `,`, > 0, не больше 2 знаков после разделителя; хранится в копейках | `invalid_amount` |
| `currency` | обрезать, в верхний регистр; `RUB`, `USD` или `EUR` | `invalid_currency` |
| `created_at` | `YYYY-MM-DD` или `YYYY-MM-DDTHH:MM:SS` (можно с `Z`), реальная дата; хранится только дата | `invalid_date` |

## Выход

```sql
orders(order_id TEXT PRIMARY KEY, customer_email TEXT NOT NULL, amount_kop INTEGER NOT NULL,
       currency TEXT NOT NULL, order_date TEXT NOT NULL)
rejected(line INTEGER NOT NULL, order_id TEXT, reason TEXT NOT NULL)
```

- `line` — номер строки файла, заголовок — строка 1. `order_id` в `rejected` — как в файле после обрезки (или пусто).
- **Дубли в файле**: побеждает первая валидная строка с этим `order_id`; следующие валидные с тем же `order_id`
  не загружаются и не отбраковываются, а считаются в `duplicates`.
- **Перезапуск** на той же базе идемпотентен: `orders` — upsert по `order_id` (значения из нового запуска),
  `rejected` очищается и отражает последний запуск.
- Отчёт: `read` — строк данных, `loaded` — уникальных валидных, `rejected`, `duplicates`; `read = loaded + rejected + duplicates`.
- Таблицы создаются, если их нет. Все записи запуска — в одной транзакции.

Пример — `data/orders.csv`. Видимые тесты — `tests/visible/` (`python -m pytest tests/visible`).
