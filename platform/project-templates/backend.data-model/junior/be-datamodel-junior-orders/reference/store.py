"""Учёт заказов поверх SQLite по контракту (contract.md)."""
import sqlite3


class DataError(Exception):
    pass


class DuplicateError(DataError):
    pass


class NotFoundError(DataError):
    pass


class ValidationError(DataError):
    pass


class InUseError(DataError):
    pass


SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    price_kop INTEGER NOT NULL CHECK (price_kop >= 0)
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price_kop INTEGER NOT NULL CHECK (unit_price_kop >= 0),
    PRIMARY KEY (order_id, product_id)
);
"""


def connect(path=":memory:"):
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def _text(value, what):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{what}: нужна непустая строка")
    return value.strip()


def _int(value, what, minimum):
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise ValidationError(f"{what}: нужно целое >= {minimum}")
    return value


def add_customer(conn, email, name):
    email = _text(email, "email").lower()
    name = _text(name, "name")
    local, sep, domain = email.partition("@")
    if not sep or not local or not domain:
        raise ValidationError("email: некорректный адрес")
    try:
        with conn:
            cur = conn.execute("INSERT INTO customers (email, name) VALUES (?, ?)", (email, name))
    except sqlite3.IntegrityError as exc:
        raise DuplicateError(email) from exc
    return cur.lastrowid


def add_product(conn, sku, title, price_kop):
    sku = _text(sku, "sku")
    title = _text(title, "title")
    _int(price_kop, "price_kop", 0)
    try:
        with conn:
            cur = conn.execute("INSERT INTO products (sku, title, price_kop) VALUES (?, ?, ?)", (sku, title, price_kop))
    except sqlite3.IntegrityError as exc:
        raise DuplicateError(sku) from exc
    return cur.lastrowid


def create_order(conn, customer_id, items, created_at):
    _text(created_at, "created_at")
    if not isinstance(items, (list, tuple)) or not items:
        raise ValidationError("items: нужен непустой список")
    seen = set()
    for sku, qty in items:
        _int(qty, "qty", 1)
        if sku in seen:
            raise ValidationError(f"повтор sku {sku}")
        seen.add(sku)
    if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:
        raise NotFoundError(f"клиент {customer_id}")
    prices = {}
    for sku, _ in items:
        row = conn.execute("SELECT id, price_kop FROM products WHERE sku = ?", (sku,)).fetchone()
        if row is None:
            raise NotFoundError(f"товар {sku}")
        prices[sku] = row
    with conn:
        order_id = conn.execute(
            "INSERT INTO orders (customer_id, created_at) VALUES (?, ?)", (customer_id, created_at)
        ).lastrowid
        for sku, qty in items:
            product_id, price = prices[sku]
            conn.execute(
                "INSERT INTO order_items (order_id, product_id, qty, unit_price_kop) VALUES (?, ?, ?, ?)",
                (order_id, product_id, qty, price),
            )
    return order_id


def order_total(conn, order_id):
    if conn.execute("SELECT 1 FROM orders WHERE id = ?", (order_id,)).fetchone() is None:
        raise NotFoundError(f"заказ {order_id}")
    return conn.execute(
        "SELECT COALESCE(SUM(qty * unit_price_kop), 0) FROM order_items WHERE order_id = ?", (order_id,)
    ).fetchone()[0]


def customer_report(conn):
    rows = conn.execute(
        """
        SELECT c.id, c.email, COUNT(DISTINCT o.id), COALESCE(SUM(i.qty * i.unit_price_kop), 0) AS total
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id
        LEFT JOIN order_items i ON i.order_id = o.id
        GROUP BY c.id
        ORDER BY total DESC, c.email ASC
        """
    ).fetchall()
    return [{"customer_id": r[0], "email": r[1], "orders": r[2], "total_kop": r[3]} for r in rows]


def top_products(conn, limit=3):
    _int(limit, "limit", 1)
    rows = conn.execute(
        """
        SELECT p.sku, p.title, SUM(i.qty) AS qty, SUM(i.qty * i.unit_price_kop)
        FROM order_items i JOIN products p ON p.id = i.product_id
        GROUP BY p.id
        ORDER BY qty DESC, p.sku ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [{"sku": r[0], "title": r[1], "qty": r[2], "revenue_kop": r[3]} for r in rows]


def delete_customer(conn, customer_id):
    if conn.execute("SELECT 1 FROM customers WHERE id = ?", (customer_id,)).fetchone() is None:
        raise NotFoundError(f"клиент {customer_id}")
    if conn.execute("SELECT 1 FROM orders WHERE customer_id = ?", (customer_id,)).fetchone() is not None:
        raise InUseError(f"у клиента {customer_id} есть заказы")
    with conn:
        conn.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
