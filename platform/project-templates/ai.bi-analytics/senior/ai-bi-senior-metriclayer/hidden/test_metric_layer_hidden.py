# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import copy
import math
import os
import re

import numpy as np
import pandas as pd
import pytest

import metric_layer as ml


def orders_df():
    return pd.DataFrame({
        "order_id": ["o1", "o2", "o3", "o4", "o5", "o6", "o7"],
        "customer_id": ["c1", "c1", "c2", "c3", "c4", "c2", "c5"],
        "region": ["north", "north", "south", "south", None, "north", "north"],
        "status": ["paid", "paid", "paid", "cancelled", "paid", "paid", "paid"],
        "amount": [100, 50, 200, 300, 80, None, 70],
        "order_date": ["2026-01-05", "2026-01-20", "2026-02-03", "2026-02-04", "2026-02-10", "2026-02-11", "bad-date"],
    })


def visits_df():
    return pd.DataFrame({
        "day": ["2026-01-03", "2026-01-15", "2026-02-02", "2026-02-09"],
        "region": ["north", "south", "north", "south"],
        "visits": [100, 50, 200, 100],
    })


PAID = {"status": "paid"}
DEFS = {
    "revenue": {"type": "sum", "table": "orders", "column": "amount", "time": "order_date", "filter": PAID},
    "orders_cnt": {"type": "count_distinct", "table": "orders", "column": "order_id", "time": "order_date", "filter": PAID},
    "customers": {"type": "count_distinct", "table": "orders", "column": "customer_id", "time": "order_date", "filter": PAID},
    "rows": {"type": "count", "table": "orders", "time": "order_date"},
    "aov": {"type": "ratio", "numerator": "revenue", "denominator": "orders_cnt"},
    "rev_per_customer": {"type": "ratio", "numerator": "revenue", "denominator": "customers"},
    "visits": {"type": "sum", "table": "visits", "column": "visits", "time": "day"},
    "conv": {"type": "ratio", "numerator": "orders_cnt", "denominator": "visits"},
}


def layer(defs=None):
    return ml.MetricLayer(copy.deepcopy(DEFS if defs is None else defs), {"orders": orders_df(), "visits": visits_df()})


def col(df, name):
    return list(df[name])


class TestDefinitions:
    def test_inputs_not_mutated(self):
        defs, o, v = copy.deepcopy(DEFS), orders_df(), visits_df()
        lay = ml.MetricLayer(defs, {"orders": o, "visits": v})
        lay.query("revenue", by=["month"], filters={"region": "north"})
        lay.query("aov")
        assert defs == DEFS
        pd.testing.assert_frame_equal(o, orders_df())
        pd.testing.assert_frame_equal(v, visits_df())

    @pytest.mark.parametrize("bad", [
        {"type": "avg", "table": "orders", "column": "amount"},
        {"type": "sum", "table": "orders"},
        {"type": "count_distinct", "table": "orders"},
        {"table": "orders", "column": "amount"},
        "revenue",
        {"type": "ratio", "numerator": "x"},
    ])
    def test_bad_type(self, bad):
        with pytest.raises(ValueError, match="bad type: m"):
            layer({"m": bad})

    def test_unknown_table_and_columns(self):
        with pytest.raises(ValueError, match="unknown table: nope"):
            layer({"m": {"type": "count", "table": "nope"}})
        with pytest.raises(ValueError, match=r"unknown column: orders\.ghost"):
            layer({"m": {"type": "sum", "table": "orders", "column": "ghost"}})
        with pytest.raises(ValueError, match=r"unknown column: orders\.when"):
            layer({"m": {"type": "count", "table": "orders", "time": "when"}})
        with pytest.raises(ValueError, match=r"unknown column: orders\.zzz"):
            layer({"m": {"type": "count", "table": "orders", "filter": {"zzz": 1}}})

    def test_check_order_within_metric(self):
        # колонка проверяется раньше time и фильтра
        d = {"m": {"type": "sum", "table": "orders", "column": "ghost", "time": "when", "filter": {"zzz": 1}}}
        with pytest.raises(ValueError, match=r"unknown column: orders\.ghost"):
            layer(d)

    def test_base_checks_before_ratio_refs(self):
        d = {"r": {"type": "ratio", "numerator": "missing", "denominator": "b"}, "b": {"type": "avg", "table": "orders", "column": "amount"}}
        with pytest.raises(ValueError, match="bad type: b"):
            layer(d)

    def test_unknown_metric_reference(self):
        d = {"revenue": DEFS["revenue"], "r": {"type": "ratio", "numerator": "revenue", "denominator": "ghost"}}
        with pytest.raises(ValueError, match="unknown metric: ghost"):
            layer(d)

    def test_cycles(self):
        rev = DEFS["revenue"]
        selfref = {"revenue": rev, "x": {"type": "ratio", "numerator": "x", "denominator": "revenue"}}
        with pytest.raises(ValueError, match="cyclic definition: x"):
            layer(selfref)
        two = {"revenue": rev, "a": {"type": "ratio", "numerator": "b", "denominator": "revenue"},
               "b": {"type": "ratio", "numerator": "a", "denominator": "revenue"}}
        with pytest.raises(ValueError, match="cyclic definition: a"):
            layer(two)
        # p зависит от цикла, но сам в нём не участвует: ошибка называет q
        tail = {"revenue": rev, "p": {"type": "ratio", "numerator": "revenue", "denominator": "q"},
                "q": {"type": "ratio", "numerator": "r", "denominator": "revenue"},
                "r": {"type": "ratio", "numerator": "q", "denominator": "revenue"}}
        with pytest.raises(ValueError, match="cyclic definition: q"):
            layer(tail)

    def test_nested_ratio_is_allowed(self):
        d = dict(DEFS)
        d["aov_share"] = {"type": "ratio", "numerator": "aov", "denominator": "rev_per_customer"}
        r = layer(d).query("aov_share")
        assert r["aov_share"].iloc[0] == round((500 / 6) / (500 / 4), 4)


class TestQuery:
    def test_totals_types_and_rounding(self):
        lay = layer()
        r = lay.query("revenue")
        assert list(r.columns) == ["revenue"] and len(r) == 1 and r["revenue"].iloc[0] == 500.0
        assert r["revenue"].dtype == np.float64
        assert lay.query("orders_cnt")["orders_cnt"].iloc[0] == 6 and lay.query("orders_cnt")["orders_cnt"].dtype == np.int64
        assert lay.query("rows")["rows"].iloc[0] == 7
        assert lay.query("aov")["aov"].iloc[0] == 83.3333
        assert lay.query("customers")["customers"].iloc[0] == 4

    def test_missing_dimension_value_is_none_group(self):
        r = layer().query("revenue", by=["region"])
        assert col(r, "region") == ["(none)", "north", "south"]
        assert col(r, "revenue") == [80.0, 220.0, 200.0]
        assert list(r.index) == [0, 1, 2]

    def test_nan_amount_skipped_not_poisoning(self):
        r = layer().query("revenue", by=["region"], filters={"region": "north"})
        assert col(r, "revenue") == [220.0]

    def test_month_dimension_with_unparseable_date(self):
        r = layer().query("revenue", by=["month"])
        assert col(r, "month") == ["(none)", "2026-01", "2026-02"]
        assert col(r, "revenue") == [70.0, 150.0, 280.0]

    def test_real_column_beats_month_alias(self):
        o = orders_df()
        o["month"] = "M"
        lay = ml.MetricLayer(copy.deepcopy(DEFS), {"orders": o, "visits": visits_df()})
        assert col(lay.query("revenue", by=["month"]), "month") == ["M"]

    def test_count_and_distinct(self):
        lay = layer()
        r = lay.query("rows", by=["status"])
        assert col(r, "status") == ["cancelled", "paid"] and col(r, "rows") == [1, 6]
        r = lay.query("orders_cnt", by=["region"])
        assert col(r, "orders_cnt") == [1, 4, 1]

    def test_ratio_from_aggregates_not_mean_of_ratios(self):
        r = layer().query("aov", by=["region"])
        assert col(r, "region") == ["(none)", "north", "south"]
        assert col(r, "aov") == [80.0, 55.0, 200.0]
        # среднее отношений групп (111.67) не равно итогу (83.33)
        assert layer().query("aov")["aov"].iloc[0] != round(sum(col(r, "aov")) / 3, 4)

    def test_filters_and(self):
        lay = layer()
        assert lay.query("revenue", filters={"region": "north"})["revenue"].iloc[0] == 220.0
        assert lay.query("revenue", filters={"month": ["2026-01", "2026-02"]})["revenue"].iloc[0] == 430.0
        assert lay.query("revenue", filters={"region": "north", "month": "2026-01"})["revenue"].iloc[0] == 150.0
        assert lay.query("aov", filters={"region": "north"})["aov"].iloc[0] == 55.0
        assert lay.query("revenue", filters={"region": "(none)"})["revenue"].iloc[0] == 80.0

    def test_definition_filter_with_list_values(self):
        d = dict(DEFS)
        d["all_rev"] = {"type": "sum", "table": "orders", "column": "amount", "filter": {"status": ["paid", "cancelled"]}}
        assert layer(d).query("all_rev")["all_rev"].iloc[0] == 800.0

    def test_empty_slice(self):
        lay = layer()
        assert lay.query("revenue", filters={"region": "mars"})["revenue"].iloc[0] == 0.0
        assert lay.query("orders_cnt", filters={"region": "mars"})["orders_cnt"].iloc[0] == 0
        assert math.isnan(lay.query("aov", filters={"region": "mars"})["aov"].iloc[0])
        e = lay.query("revenue", by=["region"], filters={"region": "mars"})
        assert len(e) == 0 and list(e.columns) == ["region", "revenue"]

    def test_two_dimensions_sorted(self):
        r = layer().query("rows", by=["region", "status"])
        assert list(zip(r["region"], r["status"], r["rows"])) == [
            ("(none)", "paid", 1), ("north", "paid", 4), ("south", "cancelled", 1), ("south", "paid", 1)]

    def test_cross_table_ratio_outer_join(self):
        r = layer().query("conv", by=["region"])
        assert col(r, "region") == ["(none)", "north", "south"]
        assert math.isnan(r["conv"].iloc[0])           # заказ есть, визитов нет: знаменатель 0 -> NaN
        assert r["conv"].iloc[1] == round(4 / 300, 4) and r["conv"].iloc[2] == round(1 / 150, 4)
        assert layer().query("conv")["conv"].iloc[0] == round(6 / 450, 4)

    def test_numerator_missing_side_is_zero(self):
        d = dict(DEFS)
        d["south_share"] = {"type": "ratio", "numerator": "orders_cnt", "denominator": "visits"}
        v = visits_df()
        v.loc[len(v)] = ["2026-03-01", "east", 40]
        lay = ml.MetricLayer(d, {"orders": orders_df(), "visits": v})
        r = lay.query("south_share", by=["region"])
        east = r[r["region"] == "east"]["south_share"].iloc[0]
        assert east == 0.0

    def test_ratio_dimension_must_exist_for_all_leaves(self):
        with pytest.raises(ValueError, match="unknown dimension: customer_id"):
            layer().query("conv", by=["customer_id"])
        with pytest.raises(ValueError, match="unknown dimension: status"):
            layer().query("conv", filters={"status": "paid"})
        assert len(layer().query("conv", by=["month"])) >= 2

    def test_errors(self):
        lay = layer()
        with pytest.raises(ValueError, match="unknown metric: ghost"):
            lay.query("ghost")
        with pytest.raises(ValueError, match="unknown dimension: color"):
            lay.query("revenue", by=["color"])
        with pytest.raises(ValueError, match="unknown dimension: color"):
            lay.query("revenue", filters={"color": "red"})
        with pytest.raises(ValueError, match="bad by"):
            lay.query("revenue", by=["region", "region"])
        with pytest.raises(ValueError, match="unknown dimension: month"):
            ml.MetricLayer({"x": {"type": "count", "table": "orders"}}, {"orders": orders_df()}).query("x", by=["month"])


class TestReconcile:
    def test_sum_and_count_are_additive_and_consistent(self):
        for m, total in (("revenue", 500.0), ("rows", 7)):
            for by in (["region"], ["month"], ["region", "status"]):
                rec = layer().reconcile(m, by)
                assert rec["additive"] is True and rec["consistent"] is True
                assert rec["total"] == total and rec["grouped_sum"] == total and rec["diff"] == 0

    def test_keys(self):
        rec = layer().reconcile("revenue", ["region"])
        assert set(rec) == {"metric", "total", "grouped_sum", "diff", "additive", "consistent"} and rec["metric"] == "revenue"

    def test_count_distinct_not_additive_signal(self):
        # клиент c2 попал и в north, и в south: сумма срезов больше итога
        rec = layer().reconcile("customers", ["region"])
        assert rec["additive"] is False and rec["total"] == 4 and rec["grouped_sum"] == 5
        assert rec["diff"] == -1 and rec["consistent"] is False

    def test_count_distinct_consistent_when_dimension_is_function_of_entity(self):
        rec = layer().reconcile("orders_cnt", ["region"])
        assert rec["additive"] is False and rec["consistent"] is True and rec["total"] == rec["grouped_sum"] == 6

    def test_ratio(self):
        rec = layer().reconcile("aov", ["region"])
        assert rec == {"metric": "aov", "total": 83.3333, "grouped_sum": None, "diff": None, "additive": False, "consistent": None}

    def test_rounding_does_not_fake_inconsistency(self):
        o = pd.DataFrame({"g": ["a", "b", "c"], "x": [0.004, 0.004, 0.004]})
        lay = ml.MetricLayer({"s": {"type": "sum", "table": "t", "column": "x"}}, {"t": o})
        rec = lay.reconcile("s", ["g"])
        assert rec["consistent"] is True and rec["total"] == 0.01

    def test_unknown(self):
        with pytest.raises(ValueError, match="unknown metric: ghost"):
            layer().reconcile("ghost", ["region"])
        with pytest.raises(ValueError, match="unknown dimension: color"):
            layer().reconcile("revenue", ["color"])


class TestDuplicates:
    def test_find_duplicates(self):
        d = copy.deepcopy(DEFS)
        d["revenue_copy"] = {"type": "sum", "table": "orders", "column": "amount", "time": "order_date", "filter": {"status": ["paid"]}}
        d["gmv_paid"] = {"filter": {"status": "paid"}, "time": "order_date", "column": "amount", "table": "orders", "type": "sum"}
        d["rows2"] = {"type": "count", "table": "orders", "column": "region", "time": "order_date"}
        d["aov2"] = {"type": "ratio", "numerator": "revenue", "denominator": "orders_cnt"}
        d["revenue_no_filter"] = {"type": "sum", "table": "orders", "column": "amount", "time": "order_date"}
        assert ml.find_duplicates(d) == [["aov", "aov2"], ["gmv_paid", "revenue", "revenue_copy"], ["rows", "rows2"]]

    def test_filter_value_order_and_keys(self):
        a = {"type": "sum", "table": "t", "column": "x", "filter": {"s": ["b", "a"], "k": 1}}
        b = {"type": "sum", "table": "t", "column": "x", "filter": {"k": 1, "s": ["a", "b"]}}
        c = {"type": "sum", "table": "t", "column": "x", "filter": {"k": 1, "s": ["a"]}}
        assert ml.find_duplicates({"a": a, "b": b, "c": c}) == [["a", "b"]]

    def test_no_duplicates(self):
        assert ml.find_duplicates(copy.deepcopy(DEFS)) == []

    def test_does_not_mutate(self):
        d = copy.deepcopy(DEFS)
        ml.find_duplicates(d)
        assert d == DEFS


class TestPlanVsFact:
    def plan(self):
        return pd.DataFrame({"month": ["2026-01", "2026-02", "2026-03"], "plan": [150, 400, 100]})

    def test_statuses_and_layout(self):
        res = ml.plan_vs_fact(layer(), self.plan(), "revenue")
        assert list(res.columns) == ["month", "fact", "plan", "delta", "delta_pct", "status"]
        assert col(res, "month") == ["(none)", "2026-01", "2026-02", "2026-03"]
        assert col(res, "fact") == [70.0, 150.0, 280.0, 0.0]
        assert math.isnan(res["plan"].iloc[0]) and col(res, "plan")[1:] == [150.0, 400.0, 100.0]
        assert col(res, "delta")[1:] == [0.0, -120.0, -100.0]
        assert col(res, "delta_pct")[1:] == [0.0, -0.3, -1.0]
        assert col(res, "status") == ["no_plan", "on_plan", "under", "under"]
        assert math.isnan(res["delta"].iloc[0]) and math.isnan(res["delta_pct"].iloc[0])
        assert list(res.index) == [0, 1, 2, 3]

    def test_over_and_tolerance_boundary_inclusive(self):
        t = pd.DataFrame({"g": ["a", "b", "c", "d"], "x": [105, 95, 106, 94]})
        lay = ml.MetricLayer({"s": {"type": "sum", "table": "t", "column": "x"}}, {"t": t})
        plan = pd.DataFrame({"g": list("abcd"), "plan": [100, 100, 100, 100]})
        res = ml.plan_vs_fact(lay, plan, "s", by=["g"], tolerance=0.05)
        assert col(res, "status") == ["on_plan", "on_plan", "over", "under"]
        res = ml.plan_vs_fact(lay, plan, "s", by=["g"], tolerance=0.0)
        assert col(res, "status") == ["over", "under", "over", "under"]
        res = ml.plan_vs_fact(lay, plan, "s", by=["g"], tolerance=1)
        assert set(col(res, "status")) == {"on_plan"}

    def test_zero_plan(self):
        plan = pd.DataFrame({"month": ["2026-01", "2026-04"], "plan": [0, 0]})
        res = ml.plan_vs_fact(layer(), plan, "revenue")
        st = dict(zip(res["month"], res["status"]))
        assert st["2026-01"] == "no_target" and st["2026-04"] == "on_plan"
        row = res[res["month"] == "2026-01"].iloc[0]
        assert math.isnan(row["delta_pct"]) and row["delta"] == 150.0

    def test_ratio_metric_and_no_fact(self):
        plan = pd.DataFrame({"region": ["north", "south", "east"], "plan": [60.0, 200.0, 10.0]})
        res = ml.plan_vs_fact(layer(), plan, "aov", by=["region"])
        st = dict(zip(res["region"], res["status"]))
        assert st == {"(none)": "no_plan", "east": "under", "north": "under", "south": "on_plan"}
        assert res[res["region"] == "north"]["delta_pct"].iloc[0] == round((55 - 60) / 60, 4)

    def test_no_fact_for_nan_ratio(self):
        plan = pd.DataFrame({"region": ["(none)"], "plan": [0.5]})
        res = ml.plan_vs_fact(layer(), plan, "conv", by=["region"])
        assert dict(zip(res["region"], res["status"]))["(none)"] == "no_fact"

    def test_two_dimensions(self):
        plan = pd.DataFrame({"region": ["north", "north"], "month": ["2026-01", "2026-02"], "plan": [100, 200]})
        res = ml.plan_vs_fact(layer(), plan, "revenue", by=["region", "month"])
        row = res[(res["region"] == "north") & (res["month"] == "2026-01")].iloc[0]
        assert row["fact"] == 150.0 and row["status"] == "over"

    def test_plan_keys_cast_to_string(self):
        o = pd.DataFrame({"y": [2025, 2025, 2026], "v": [1, 2, 3]})
        lay = ml.MetricLayer({"s": {"type": "sum", "table": "t", "column": "v"}}, {"t": o})
        res = ml.plan_vs_fact(lay, pd.DataFrame({"y": [2025, 2026], "plan": [3, 3]}), "s", by=["y"])
        assert col(res, "status") == ["on_plan", "on_plan"]

    def test_errors(self):
        lay = layer()
        with pytest.raises(ValueError, match="missing column: plan"):
            ml.plan_vs_fact(lay, self.plan().drop(columns=["plan"]), "revenue")
        with pytest.raises(ValueError, match="missing column: month"):
            ml.plan_vs_fact(lay, self.plan().drop(columns=["month"]), "revenue")
        with pytest.raises(ValueError, match="duplicate plan key"):
            ml.plan_vs_fact(lay, pd.concat([self.plan(), self.plan().iloc[[0]]]), "revenue")
        for bad in (-0.1, "0.1", None, float("nan"), True):
            with pytest.raises(ValueError, match="bad tolerance"):
                ml.plan_vs_fact(lay, self.plan(), "revenue", tolerance=bad)
        with pytest.raises(ValueError, match="bad by"):
            ml.plan_vs_fact(lay, self.plan(), "revenue", by=())
        with pytest.raises(ValueError, match="unknown metric: ghost"):
            ml.plan_vs_fact(lay, self.plan(), "ghost")

    def test_plan_not_mutated(self):
        p = self.plan()
        before = p.copy(deep=True)
        ml.plan_vs_fact(layer(), p, "revenue")
        pd.testing.assert_frame_equal(p, before)


class TestDesign:
    def test_design_md_sections(self):
        path = os.path.join(os.path.dirname(os.path.abspath(ml.__file__)), "DESIGN.md")
        assert os.path.exists(path), "нет DESIGN.md в корне репозитория"
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for h in ("Решения", "Компромиссы", "Границы применимости"):
            m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
            assert m is not None, h
            assert len(m.group(1).strip()) >= 200, h
