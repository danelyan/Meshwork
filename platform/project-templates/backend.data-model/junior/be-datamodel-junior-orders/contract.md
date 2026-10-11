<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: схема и запросы для учёта заказов (Junior)

Python 3.12, только стандартная библиотека (`sqlite3`). Модуль `store.py` в корне репозитория.
Данные хранятся в SQLite; схему вы проектируете сами по описанию ниже. Деньги – целые копейки.

## Схема

`connect()` создаёт недостающие таблицы (`CREATE TABLE IF NOT EXISTS`), включает `PRAGMA foreign_keys = ON`
и возвращает открытое соединение. Повторный вызов на существующем файле данные не трогает.

| Таблица | Колонки (имена обязательны) | Ограничения |
|---|---|---|
| `customers` | `id`, `email`, `name` | `id` – первичный ключ; `email` и `name` NOT NULL; `email` уникален |
| `products` | `id`, `sku`, `title`, `price_kop` | `id` – первичный ключ; `sku` уникален; все поля NOT NULL; `price_kop >= 0` |
| `orders` | `id`, `customer_id`, `created_at` | `id` – первичный ключ; `customer_id` – внешний ключ на `customers(id)`; все поля NOT NULL |
| `order_items` | `order_id`, `product_id`, `qty`, `unit_price_kop` | первичный ключ `(order_id, product_id)`; внешние ключи на `orders(id)` и `products(id)`; все поля NOT NULL; `qty > 0`; `unit_price_kop >= 0` |

Ограничения должны быть **в самой БД**: прямой `INSERT`, нарушающий любое из них, обязан падать с
`sqlite3.IntegrityError`.

## Ошибки

```python
class DataError(Exception): ...
class DuplicateError(DataError): ...    # нарушена уникальность
class NotFoundError(DataError): ...     # нет клиента, товара, заказа
class ValidationError(DataError): ...   # некорректный аргумент
class InUseError(DataError): ...        # нельзя удалить: есть зависимые записи
```

## Функции

```python
def connect(path: str = ":memory:") -> sqlite3.Connection
def add_customer(conn, email: str, name: str) -> int
def add_product(conn, sku: str, title: str, price_kop: int) -> int
def create_order(conn, customer_id: int, items: list[tuple[str, int]], created_at: str) -> int
def order_total(conn, order_id: int) -> int
def customer_report(conn) -> list[dict]
def top_products(conn, limit: int = 3) -> list[dict]
def delete_customer(conn, customer_id: int) -> None
```

- `add_customer` – возвращает `id`. `email` и `name` обрезаются по краям; `email` приводится к нижнему регистру
  и должен содержать `@` с непустыми частями с обеих сторон; `name` непустое. Нарушение – `ValidationError`.
  Повторный `email` (без учёта регистра) – `DuplicateError`, существующая запись не меняется.
- `add_product` – возвращает `id`. `sku`, `title` обрезаются и непустые; `price_kop` – `int` (не `bool`) ≥ 0,
  иначе `ValidationError`. Повторный `sku` – `DuplicateError`.
- `create_order` – `items` – список пар `(sku, qty)`. В позиции записывается **текущая цена товара**
  (`unit_price_kop`): последующее изменение цены товара старые заказы не меняет. Проверки: сначала
  `ValidationError` (пустой `items`, `qty` не `int` или ≤ 0, `bool` – не `int`, повтор `sku` в `items`,
  пустой `created_at`), затем `NotFoundError` (нет клиента или товара). При любой ошибке в БД не остаётся
  ни заказа, ни позиций.
- `order_total` – сумма `qty * unit_price_kop` по заказу; нет заказа – `NotFoundError`.
- `customer_report` – по **каждому** клиенту (в том числе без заказов): 
  `{"customer_id", "email", "orders": число заказов, "total_kop": сумма по всем его заказам}`;
  без заказов – `0` и `0`. Порядок: `total_kop` по убыванию, затем `email` по возрастанию.
- `top_products` – только проданные товары: `{"sku", "title", "qty": всего продано штук, "revenue_kop": по ценам позиций}`.
  Порядок: `qty` по убыванию, затем `sku` по возрастанию; не больше `limit` записей;
  `limit` – `int` > 0, иначе `ValidationError`.
- `delete_customer` – нет клиента: `NotFoundError`; есть хотя бы один заказ: `InUseError` (клиент остаётся);
  иначе удаляет.

Функции возвращают обычные `int`/`dict`/`list` (не `sqlite3.Row`).
