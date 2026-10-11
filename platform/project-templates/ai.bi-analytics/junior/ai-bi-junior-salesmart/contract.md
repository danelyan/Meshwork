<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: витрина метрик продаж (ai.bi-analytics, junior)

Модуль `sales_mart.py` в корне репозитория. Окружение: Python 3.12, `pandas` 2.3.3, `numpy` 2.3.3, `pytest`; сеть недоступна.
Входные `DataFrame` функциям не изменяются (работайте с копиями).

```python
def build_mart(orders: pd.DataFrame, items: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame: ...
def monthly_metrics(mart: pd.DataFrame) -> pd.DataFrame: ...
def category_share(mart: pd.DataFrame) -> pd.DataFrame: ...
```

## Входные таблицы

- `orders`: `order_id`, `customer_id`, `order_date` (`YYYY-MM-DD`), `status` (`"paid"`, `"cancelled"`, `"refunded"`).
- `items` (позиции заказов): `order_id`, `product_id`, `qty`, `unit_price`. Числа могут прийти строками.
- `products`: `product_id`, `category`.

Нет обязательной колонки в любой из таблиц → `ValueError("missing column: <имя>")` (проверка по порядку таблиц `orders`,
`items`, `products` и порядку колонок выше). Лишние колонки игнорируются.

## `build_mart`

Витрина — одна строка на позицию заказа. Шаги по порядку:

1. **Проверки.** Повтор `product_id` в `products` → `ValueError("duplicate product_id")` (иначе join размножит позиции).
   Повтор `order_id` в `orders` → `ValueError("duplicate order_id")`. `qty` и `unit_price` приводятся к числу
   (`pd.to_numeric`); нечисловое, `qty <= 0` или `unit_price < 0` → `ValueError("bad item")`.
2. **Заказы.** Берутся только `status == "paid"`. Позиции заказов, которых нет среди оплаченных (в том числе неизвестных
   `order_id`), в витрину не попадают. `order_date` → `datetime64[ns]`; нечитаемая дата → `ValueError("bad date")`.
3. **Товары.** Join позиций с товарами — левый: позиция с неизвестным `product_id` или пустой категорией остаётся,
   `category = "unknown"`. Категория приводится к строке, обрезается по краям.
4. **Расчёт.** `revenue = qty * unit_price`, `month` — строка `YYYY-MM` по `order_date`.

Результат — колонки по порядку: `order_id` (str), `order_date` (datetime64[ns]), `month` (str), `customer_id` (str),
`product_id` (str), `category` (str), `qty` (float64), `revenue` (float64). Строки отсортированы по `order_id`, затем
`product_id` (как строки); индекс `0..n-1`. Нет оплаченных заказов с позициями — пустой `DataFrame` с теми же колонками.

## `monthly_metrics(mart)`

По месяцам витрины: `DataFrame` с колонками `month`, `orders` (число различных `order_id`), `customers` (число
различных `customer_id`), `units` (сумма `qty`), `revenue` (сумма `revenue`), `aov` (средний чек =
`revenue / orders`). Выручка и `aov` округлены до 2 знаков; `units` — float. Строки по возрастанию `month`, индекс `0..n-1`.
Пустая витрина — пустой `DataFrame` с теми же колонками.

Важно: `orders` и `customers` считаются по различным значениям, а не по числу строк витрины (в заказе несколько позиций).

## `category_share(mart)`

По категориям: `category`, `revenue` (сумма, округлена до 2 знаков), `share` (доля выручки категории от общей выручки,
округлена до 4 знаков; при нулевой общей выручке — `0.0`). Порядок: по `revenue` по убыванию, затем по `category`
по возрастанию; индекс `0..n-1`. Пустая витрина — пустой `DataFrame` с теми же колонками.

Видимые тесты — `tests/visible/` (`python -m pytest tests/visible`).
