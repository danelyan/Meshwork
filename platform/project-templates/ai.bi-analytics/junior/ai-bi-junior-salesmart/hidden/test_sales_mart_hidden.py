# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import numpy as np
import pandas as pd
import pytest

import sales_mart as sm

MART_COLS = ["order_id", "order_date", "month", "customer_id", "product_id", "category", "qty", "revenue"]


def orders_df(rows):
    return pd.DataFrame(rows, columns=["order_id", "customer_id", "order_date", "status"])


def items_df(rows):
    return pd.DataFrame(rows, columns=["order_id", "product_id", "qty", "unit_price"])


def products_df(rows):
    return pd.DataFrame(rows, columns=["product_id", "category"])


def base():
    o = orders_df([
        ["o1", "c1", "2026-01-10", "paid"],
        ["o2", "c1", "2026-01-25", "paid"],
        ["o3", "c2", "2026-02-02", "paid"],
        ["o4", "c3", "2026-02-03", "cancelled"],
        ["o5", "c3", "2026-02-04", "refunded"],
    ])
    i = items_df([
        ["o1", "p1", 2, 100.0], ["o1", "p2", 1, 50.0],
        ["o2", "p1", 1, 100.0],
        ["o3", "p3", 4, 25.0], ["o3", "p1", 1, 100.0],
        ["o4", "p1", 9, 100.0], ["o5", "p2", 9, 50.0],
    ])
    p = products_df([["p1", "tea"], ["p2", "cups"]])
    return o, i, p


class TestInput:
    def test_does_not_mutate_inputs(self):
        o, i, p = base()
        snaps = [x.copy(deep=True) for x in (o, i, p)]
        sm.build_mart(o, i, p)
        for a, b in zip((o, i, p), snaps):
            pd.testing.assert_frame_equal(a, b)

    @pytest.mark.parametrize("table,col", [(0, "order_id"), (0, "customer_id"), (0, "order_date"), (0, "status"),
                                           (1, "order_id"), (1, "product_id"), (1, "qty"), (1, "unit_price"),
                                           (2, "product_id"), (2, "category")])
    def test_missing_column(self, table, col):
        t = list(base())
        t[table] = t[table].drop(columns=[col])
        with pytest.raises(ValueError, match=f"missing column: {col}"):
            sm.build_mart(*t)

    def test_extra_columns_ignored(self):
        o, i, p = base()
        o["junk"] = 1
        i["note"] = "x"
        p["brand"] = "b"
        assert list(sm.build_mart(o, i, p).columns) == MART_COLS

    def test_duplicate_order_id(self):
        o, i, p = base()
        with pytest.raises(ValueError, match="duplicate order_id"):
            sm.build_mart(pd.concat([o, o.iloc[[0]]]), i, p)

    def test_duplicate_product_id_even_if_unused(self):
        o, i, p = base()
        with pytest.raises(ValueError, match="duplicate product_id"):
            sm.build_mart(o, i, pd.concat([p, products_df([["p2", "other"]])]))

    @pytest.mark.parametrize("qty,price", [(0, 10), (-1, 10), ("x", 10), (1, -5), (1, "abc"), (None, 10)])
    def test_bad_item(self, qty, price):
        o, i, p = base()
        i = i.astype({"qty": object, "unit_price": object})
        i.loc[0, "qty"] = qty
        i.loc[0, "unit_price"] = price
        with pytest.raises(ValueError, match="bad item"):
            sm.build_mart(o, i, p)

    def test_bad_date_only_for_paid(self):
        o, i, p = base()
        o.loc[3, "order_date"] = "not-a-date"  # отменённый заказ не мешает
        assert len(sm.build_mart(o, i, p)) == 5
        o.loc[0, "order_date"] = "2026-13-40"
        with pytest.raises(ValueError, match="bad date"):
            sm.build_mart(o, i, p)


class TestMart:
    def test_layout_and_dtypes(self):
        m = sm.build_mart(*base())
        assert list(m.columns) == MART_COLS
        assert [m[c].dtype.kind for c in m.columns] == ["O", "M", "O", "O", "O", "O", "f", "f"]
        assert list(m.index) == list(range(len(m)))

    def test_only_paid_orders_and_no_fanout(self):
        m = sm.build_mart(*base())
        assert set(m["order_id"]) == {"o1", "o2", "o3"}
        assert len(m) == 5  # позиции не размножены и не потеряны
        assert m["revenue"].sum() == 200 + 50 + 100 + 100 + 100

    def test_unknown_product_kept_as_unknown(self):
        m = sm.build_mart(*base())
        row = m[m["product_id"] == "p3"].iloc[0]
        assert row["category"] == "unknown" and row["revenue"] == 100.0

    def test_blank_and_missing_category_unknown(self):
        o, i, p = base()
        p = products_df([["p1", "  tea "], ["p2", None], ["p3", "   "]])
        m = sm.build_mart(o, i, p)
        cats = dict(zip(m["product_id"], m["category"]))
        assert cats == {"p1": "tea", "p2": "unknown", "p3": "unknown"}

    def test_items_of_unknown_orders_dropped(self):
        o, i, p = base()
        i = pd.concat([i, items_df([["zzz", "p1", 1, 1.0]])])
        assert "zzz" not in set(sm.build_mart(o, i, p)["order_id"])

    def test_string_numbers_and_ids_trimmed(self):
        o = orders_df([[" o1 ", " c1", "2026-03-01", "paid"]])
        i = items_df([["o1", " p1", "3", "10.5"]])
        p = products_df([["p1 ", "Tea"]])
        m = sm.build_mart(o, i, p)
        assert list(m["order_id"]) == ["o1"] and list(m["customer_id"]) == ["c1"] and list(m["category"]) == ["Tea"]
        assert m["revenue"].iloc[0] == 31.5 and m["qty"].iloc[0] == 3.0

    def test_month_and_date(self):
        m = sm.build_mart(*base())
        assert list(m["month"]) == ["2026-01", "2026-01", "2026-01", "2026-02", "2026-02"]
        assert str(m["order_date"].dtype) == "datetime64[ns]"

    def test_sorted_by_string_order_then_product(self):
        o = orders_df([["o10", "c", "2026-01-01", "paid"], ["o2", "c", "2026-01-01", "paid"]])
        i = items_df([["o2", "p2", 1, 1], ["o10", "p1", 1, 1], ["o2", "p1", 1, 1]])
        m = sm.build_mart(o, i, products_df([["p1", "a"], ["p2", "b"]]))
        assert list(zip(m["order_id"], m["product_id"])) == [("o10", "p1"), ("o2", "p1"), ("o2", "p2")]

    def test_no_paid_gives_empty_with_columns(self):
        o, i, p = base()
        o["status"] = "cancelled"
        m = sm.build_mart(o, i, p)
        assert len(m) == 0 and list(m.columns) == MART_COLS


class TestMonthly:
    def test_values(self):
        m = sm.monthly_metrics(sm.build_mart(*base()))
        assert list(m.columns) == ["month", "orders", "customers", "units", "revenue", "aov"]
        assert list(m["month"]) == ["2026-01", "2026-02"]
        assert list(m["orders"]) == [2, 1]
        assert list(m["customers"]) == [1, 1]
        assert list(m["units"]) == [4.0, 5.0]
        assert list(m["revenue"]) == [350.0, 200.0]
        assert list(m["aov"]) == [175.0, 200.0]

    def test_distinct_not_row_counts(self):
        o = orders_df([["o1", "c1", "2026-01-01", "paid"]])
        i = items_df([["o1", "p1", 1, 1], ["o1", "p2", 1, 1], ["o1", "p3", 1, 1]])
        m = sm.monthly_metrics(sm.build_mart(o, i, products_df([["p1", "a"], ["p2", "a"], ["p3", "a"]])))
        assert m["orders"].iloc[0] == 1 and m["customers"].iloc[0] == 1 and m["aov"].iloc[0] == 3.0

    def test_rounding(self):
        o = orders_df([["o1", "c1", "2026-01-01", "paid"], ["o2", "c2", "2026-01-02", "paid"], ["o3", "c3", "2026-01-03", "paid"]])
        i = items_df([["o1", "p1", 1, 10.0], ["o2", "p1", 1, 10.0], ["o3", "p1", 1, 10.01]])
        m = sm.monthly_metrics(sm.build_mart(o, i, products_df([["p1", "a"]])))
        assert m["revenue"].iloc[0] == 30.01 and m["aov"].iloc[0] == 10.0

    def test_sorted_by_month_across_years(self):
        o = orders_df([["a", "c", "2026-01-05", "paid"], ["b", "c", "2025-12-30", "paid"]])
        i = items_df([["a", "p1", 1, 1], ["b", "p1", 1, 1]])
        m = sm.monthly_metrics(sm.build_mart(o, i, products_df([["p1", "x"]])))
        assert list(m["month"]) == ["2025-12", "2026-01"] and list(m.index) == [0, 1]

    def test_empty(self):
        o, i, p = base()
        o["status"] = "refunded"
        m = sm.monthly_metrics(sm.build_mart(o, i, p))
        assert len(m) == 0 and list(m.columns) == ["month", "orders", "customers", "units", "revenue", "aov"]


class TestCategoryShare:
    def test_values_and_order(self):
        s = sm.category_share(sm.build_mart(*base()))
        assert list(s.columns) == ["category", "revenue", "share"]
        assert list(s["category"]) == ["tea", "unknown", "cups"]
        assert list(s["revenue"]) == [400.0, 100.0, 50.0]
        assert list(s["share"]) == [0.7273, 0.1818, 0.0909]
        assert list(s.index) == [0, 1, 2]

    def test_ties_sorted_by_category(self):
        o = orders_df([["o1", "c", "2026-01-01", "paid"]])
        i = items_df([["o1", "p1", 1, 10], ["o1", "p2", 1, 10], ["o1", "p3", 1, 10]])
        s = sm.category_share(sm.build_mart(o, i, products_df([["p1", "b"], ["p2", "a"], ["p3", "c"]])))
        assert list(s["category"]) == ["a", "b", "c"]

    def test_zero_revenue_share_zero(self):
        o = orders_df([["o1", "c", "2026-01-01", "paid"]])
        i = items_df([["o1", "p1", 1, 0]])
        s = sm.category_share(sm.build_mart(o, i, products_df([["p1", "a"]])))
        assert list(s["share"]) == [0.0] and not np.isnan(s["share"].iloc[0])

    def test_empty(self):
        o, i, p = base()
        o["status"] = "cancelled"
        s = sm.category_share(sm.build_mart(o, i, p))
        assert len(s) == 0 and list(s.columns) == ["category", "revenue", "share"]
