# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import sqlite3

import pytest

import store


@pytest.fixture
def conn():
    c = store.connect()
    yield c
    c.close()


def cols(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def seed(conn):
    a = store.add_customer(conn, "a@x.io", "A")
    b = store.add_customer(conn, "b@x.io", "B")
    store.add_customer(conn, "c@x.io", "C")
    store.add_product(conn, "pen", "Pen", 100)
    store.add_product(conn, "ink", "Ink", 250)
    store.add_product(conn, "pad", "Pad", 400)
    return a, b


def test_schema_has_required_tables_and_columns(conn):
    assert {"id", "email", "name"} <= cols(conn, "customers")
    assert {"id", "sku", "title", "price_kop"} <= cols(conn, "products")
    assert {"id", "customer_id", "created_at"} <= cols(conn, "orders")
    assert {"order_id", "product_id", "qty", "unit_price_kop"} <= cols(conn, "order_items")


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO customers (email, name) VALUES ('x@x.io', NULL)",
        "INSERT INTO customers (email, name) VALUES (NULL, 'X')",
        "INSERT INTO products (sku, title, price_kop) VALUES ('s', 't', -1)",
        "INSERT INTO products (sku, title, price_kop) VALUES ('s', NULL, 1)",
        "INSERT INTO orders (customer_id, created_at) VALUES (NULL, '2026-10-01')",
        "INSERT INTO orders (customer_id, created_at) VALUES (999, '2026-10-01')",
    ],
)
def test_database_rejects_invalid_rows(conn, sql):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql)


def test_unique_and_item_constraints(conn):
    a, _ = seed(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO customers (email, name) VALUES ('a@x.io', 'Dup')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO products (sku, title, price_kop) VALUES ('pen', 'Dup', 1)")
    oid = store.create_order(conn, a, [("pen", 1)], "2026-10-01")
    pid = conn.execute("SELECT id FROM products WHERE sku = 'ink'").fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO order_items VALUES (?, ?, 0, 10)", (oid, pid))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO order_items VALUES (?, ?, 1, -5)", (oid, pid))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO order_items VALUES (?, 99999, 1, 10)", (oid,))
    first = conn.execute("SELECT product_id FROM order_items WHERE order_id = ?", (oid,)).fetchone()[0]
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO order_items VALUES (?, ?, 1, 10)", (oid, first))


def test_connect_is_idempotent_on_existing_file(tmp_path):
    path = str(tmp_path / "shop.db")
    c1 = store.connect(path)
    cid = store.add_customer(c1, "a@x.io", "A")
    c1.close()
    c2 = store.connect(path)
    rows = c2.execute("SELECT id, email FROM customers").fetchall()
    assert rows == [(cid, "a@x.io")]
    with pytest.raises(sqlite3.IntegrityError):
        c2.execute("INSERT INTO orders (customer_id, created_at) VALUES (999, 'x')")
    c2.close()


def test_add_customer_normalizes_and_rejects_duplicates(conn):
    cid = store.add_customer(conn, "  Anna@Example.COM ", "  Anna  ")
    assert isinstance(cid, int)
    assert conn.execute("SELECT email, name FROM customers WHERE id = ?", (cid,)).fetchone() == ("anna@example.com", "Anna")
    with pytest.raises(store.DuplicateError):
        store.add_customer(conn, "ANNA@example.com", "Other")
    assert conn.execute("SELECT COUNT(*), MIN(name) FROM customers").fetchone() == (1, "Anna")


@pytest.mark.parametrize("email,name", [("", "A"), ("no-at", "A"), ("@x.io", "A"), ("a@", "A"), ("a@x.io", "   "), (None, "A"), ("a@x.io", 5)])
def test_add_customer_validation(conn, email, name):
    with pytest.raises(store.ValidationError):
        store.add_customer(conn, email, name)
    assert conn.execute("SELECT COUNT(*) FROM customers").fetchone()[0] == 0


def test_add_product_rules(conn):
    pid = store.add_product(conn, " pen ", " Pen ", 0)
    assert conn.execute("SELECT sku, title, price_kop FROM products WHERE id = ?", (pid,)).fetchone() == ("pen", "Pen", 0)
    with pytest.raises(store.DuplicateError):
        store.add_product(conn, "pen", "Other", 5)
    for bad in (-1, 1.5, "10", True, None):
        with pytest.raises(store.ValidationError):
            store.add_product(conn, "x" + str(bad), "T", bad)
    with pytest.raises(store.ValidationError):
        store.add_product(conn, "  ", "T", 1)


def test_create_order_snapshots_price_and_total(conn):
    a, _ = seed(conn)
    oid = store.create_order(conn, a, [("pen", 3), ("ink", 2)], "2026-10-01")
    assert store.order_total(conn, oid) == 3 * 100 + 2 * 250
    conn.execute("UPDATE products SET price_kop = 1 WHERE sku = 'pen'")
    assert store.order_total(conn, oid) == 800
    oid2 = store.create_order(conn, a, [("pen", 5)], "2026-10-02")
    assert store.order_total(conn, oid2) == 5


def test_create_order_is_atomic(conn):
    a, _ = seed(conn)
    with pytest.raises(store.NotFoundError):
        store.create_order(conn, a, [("pen", 1), ("missing", 1)], "2026-10-01")
    with pytest.raises(store.NotFoundError):
        store.create_order(conn, 999, [("pen", 1)], "2026-10-01")
    assert conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM order_items").fetchone()[0] == 0


@pytest.mark.parametrize(
    "items,created",
    [([], "2026-10-01"), ([("pen", 0)], "2026-10-01"), ([("pen", -2)], "2026-10-01"), ([("pen", 1.5)], "2026-10-01"),
     ([("pen", True)], "2026-10-01"), ([("pen", 1), ("pen", 2)], "2026-10-01"), ([("pen", 1)], "")],
)
def test_create_order_validation(conn, items, created):
    a, _ = seed(conn)
    with pytest.raises(store.ValidationError):
        store.create_order(conn, a, items, created)
    assert conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0


def test_order_total_unknown_order(conn):
    with pytest.raises(store.NotFoundError):
        store.order_total(conn, 42)


def test_customer_report_counts_without_join_fanout(conn):
    a, b = seed(conn)
    store.create_order(conn, a, [("pen", 1), ("ink", 1), ("pad", 1)], "2026-10-01")  # 750
    store.create_order(conn, a, [("pen", 2), ("ink", 1), ("pad", 1)], "2026-10-02")  # 850
    store.create_order(conn, b, [("pad", 3)], "2026-10-03")  # 1200
    rep = store.customer_report(conn)
    assert rep == [
        {"customer_id": a, "email": "a@x.io", "orders": 2, "total_kop": 1600},
        {"customer_id": b, "email": "b@x.io", "orders": 1, "total_kop": 1200},
        {"customer_id": conn.execute("SELECT id FROM customers WHERE email='c@x.io'").fetchone()[0], "email": "c@x.io", "orders": 0, "total_kop": 0},
    ]


def test_customer_report_ties_sorted_by_email(conn):
    store.add_customer(conn, "z@x.io", "Z")
    store.add_customer(conn, "m@x.io", "M")
    store.add_customer(conn, "a@x.io", "A")
    assert [r["email"] for r in store.customer_report(conn)] == ["a@x.io", "m@x.io", "z@x.io"]


def test_top_products_order_limit_and_revenue(conn):
    a, b = seed(conn)
    store.add_product(conn, "cap", "Cap", 10)
    store.add_product(conn, "never", "Never sold", 10)
    store.create_order(conn, a, [("ink", 2), ("pen", 2), ("cap", 5)], "2026-10-01")
    store.create_order(conn, b, [("pen", 1), ("pad", 1)], "2026-10-02")
    conn.execute("UPDATE products SET price_kop = 7 WHERE sku = 'pen'")
    store.create_order(conn, b, [("pen", 1)], "2026-10-03")
    top = store.top_products(conn, limit=10)
    assert [t["sku"] for t in top] == ["cap", "pen", "ink", "pad"]
    assert top[1] == {"sku": "pen", "title": "Pen", "qty": 4, "revenue_kop": 300 + 7}
    assert [t["sku"] for t in store.top_products(conn)] == ["cap", "pen", "ink"]
    assert len(store.top_products(conn, 1)) == 1


@pytest.mark.parametrize("limit", [0, -1, 1.5, True, None])
def test_top_products_limit_validation(conn, limit):
    with pytest.raises(store.ValidationError):
        store.top_products(conn, limit)


def test_delete_customer_rules(conn):
    a, b = seed(conn)
    store.create_order(conn, a, [("pen", 1)], "2026-10-01")
    with pytest.raises(store.InUseError):
        store.delete_customer(conn, a)
    assert conn.execute("SELECT COUNT(*) FROM customers WHERE id = ?", (a,)).fetchone()[0] == 1
    store.delete_customer(conn, b)
    assert conn.execute("SELECT COUNT(*) FROM customers WHERE id = ?", (b,)).fetchone()[0] == 0
    with pytest.raises(store.NotFoundError):
        store.delete_customer(conn, b)
