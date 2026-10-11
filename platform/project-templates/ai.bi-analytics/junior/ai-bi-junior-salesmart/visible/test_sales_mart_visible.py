# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pandas as pd
import pytest

import sales_mart as sm


def tables():
    orders = pd.DataFrame({
        "order_id": ["o1", "o2", "o3"],
        "customer_id": ["c1", "c1", "c2"],
        "order_date": ["2026-01-10", "2026-02-03", "2026-01-20"],
        "status": ["paid", "paid", "cancelled"],
    })
    items = pd.DataFrame({
        "order_id": ["o1", "o1", "o2", "o3"],
        "product_id": ["p1", "p2", "p1", "p1"],
        "qty": ["2", 1, 3, 1],
        "unit_price": [100, "50.5", 100, 100],
    })
    products = pd.DataFrame({"product_id": ["p1", "p2"], "category": ["tea", "cups"]})
    return orders, items, products


def test_mart_only_paid_and_revenue():
    mart = sm.build_mart(*tables())
    assert list(mart.columns) == ["order_id", "order_date", "month", "customer_id", "product_id", "category", "qty", "revenue"]
    assert list(mart["order_id"]) == ["o1", "o1", "o2"]
    assert list(mart["revenue"]) == [200.0, 50.5, 300.0]


def test_monthly_counts_distinct_orders():
    m = sm.monthly_metrics(sm.build_mart(*tables()))
    assert list(m["month"]) == ["2026-01", "2026-02"]
    assert list(m["orders"]) == [1, 1] and list(m["revenue"]) == [250.5, 300.0]


def test_duplicate_product_rejected():
    o, i, p = tables()
    with pytest.raises(ValueError, match="duplicate product_id"):
        sm.build_mart(o, i, pd.concat([p, p]))


def test_category_share_sums_to_one():
    s = sm.category_share(sm.build_mart(*tables()))
    assert list(s["category"]) == ["tea", "cups"]
    assert abs(s["share"].sum() - 1.0) < 1e-3
