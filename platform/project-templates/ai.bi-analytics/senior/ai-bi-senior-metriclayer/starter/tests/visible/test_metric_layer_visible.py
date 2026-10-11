# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pandas as pd
import pytest

import metric_layer as ml

ORDERS = pd.DataFrame({
    "order_id": ["o1", "o2", "o3", "o4"],
    "customer_id": ["c1", "c1", "c2", "c3"],
    "region": ["north", "north", "south", None],
    "status": ["paid", "paid", "paid", "cancelled"],
    "amount": [100, 50, 200, 300],
    "order_date": ["2026-01-05", "2026-01-20", "2026-02-03", "2026-02-04"],
})
DEFS = {
    "revenue": {"type": "sum", "table": "orders", "column": "amount", "time": "order_date", "filter": {"status": "paid"}},
    "orders": {"type": "count_distinct", "table": "orders", "column": "order_id", "time": "order_date", "filter": {"status": "paid"}},
    "aov": {"type": "ratio", "numerator": "revenue", "denominator": "orders"},
}


def layer():
    return ml.MetricLayer(DEFS, {"orders": ORDERS})


def test_sum_and_ratio_by_region():
    r = layer().query("aov", by=["region"])
    assert list(r.columns) == ["region", "aov"]
    assert list(r["region"]) == ["north", "south"] and list(r["aov"]) == [75.0, 200.0]


def test_month_dimension_and_filter():
    q = layer().query("revenue", by=["month"], filters={"region": "north"})
    assert list(q["month"]) == ["2026-01"] and list(q["revenue"]) == [150.0]


def test_unknown_metric_and_dimension():
    with pytest.raises(ValueError, match="unknown metric: nope"):
        layer().query("nope")
    with pytest.raises(ValueError, match="unknown dimension: color"):
        layer().query("revenue", by=["color"])


def test_reconcile_and_plan():
    rec = layer().reconcile("revenue", ["region"])
    assert rec["consistent"] is True and rec["total"] == 350.0
    plan = pd.DataFrame({"month": ["2026-01", "2026-02"], "plan": [150, 300]})
    res = ml.plan_vs_fact(layer(), plan, "revenue")
    assert list(res["status"]) == ["on_plan", "under"]
