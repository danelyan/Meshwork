# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pytest

import store


@pytest.fixture
def conn():
    c = store.connect()
    yield c
    c.close()


def test_duplicate_email_is_rejected(conn):
    store.add_customer(conn, "Anna@Example.com", "Anna")
    with pytest.raises(store.DuplicateError):
        store.add_customer(conn, "anna@example.com", "Other")


def test_order_total_uses_price_at_order_time(conn):
    cid = store.add_customer(conn, "a@x.io", "A")
    store.add_product(conn, "pen", "Pen", 150)
    oid = store.create_order(conn, cid, [("pen", 3)], "2026-10-01")
    conn.execute("UPDATE products SET price_kop = 999 WHERE sku = 'pen'")
    assert store.order_total(conn, oid) == 450


def test_report_includes_customers_without_orders(conn):
    a = store.add_customer(conn, "a@x.io", "A")
    store.add_customer(conn, "b@x.io", "B")
    store.add_product(conn, "pen", "Pen", 100)
    store.create_order(conn, a, [("pen", 2)], "2026-10-01")
    rep = store.customer_report(conn)
    assert [(r["email"], r["orders"], r["total_kop"]) for r in rep] == [("a@x.io", 1, 200), ("b@x.io", 0, 0)]


def test_foreign_key_is_enforced_in_database(conn):
    import sqlite3

    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO orders (customer_id, created_at) VALUES (999, '2026-10-01')")
