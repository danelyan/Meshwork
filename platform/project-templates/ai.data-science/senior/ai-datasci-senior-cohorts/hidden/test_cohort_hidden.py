# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import datetime as dt
import math
import os
import re
from statistics import NormalDist

import numpy as np
import pandas as pd
import pytest

import cohort

Z = NormalDist().inv_cdf

USERS = pd.DataFrame({
    "user_id": ["a", "b", "c", "d"],
    "signup_date": ["2026-01-10", "2026-01-20", "2026-02-05", "2026-03-01"],
})
ORDERS = pd.DataFrame({
    "user_id": ["a", "a", "a", "b", "b", "c", "c", "d", "x"],
    "order_date": ["2026-01-12", "2026-02-03", "2026-04-01", "2026-01-19", "2026-01-25", "2026-02-05",
                   "2026-03-10", "2026-03-02", "2026-01-02"],
    "amount": [10.0, 20.0, 99.0, 100.0, 30.0, 7.0, 3.0, 4.0, 50.0],
})
AS_OF = "2026-03-15"


def table(**kw):
    return cohort.build_cohorts(USERS, ORDERS, AS_OF, **kw)


class TestCohorts:
    def test_full_table(self):
        t = table(horizon=2)
        assert list(t["cohort"]) == ["2026-01", "2026-02", "2026-03"]
        assert list(t["size"]) == [2, 1, 1]
        assert isinstance(t.index, pd.RangeIndex)
        nan = float("nan")
        exp = {
            "retention_0": [1.0, 1.0, 1.0], "retention_1": [0.5, 1.0, nan], "retention_2": [0.0, nan, nan],
            "ltv_0": [20.0, 7.0, 4.0], "ltv_1": [30.0, 10.0, nan], "ltv_2": [30.0, nan, nan],
        }
        for col, vals in exp.items():
            np.testing.assert_allclose(t[col].to_numpy(dtype=float), vals, equal_nan=True, err_msg=col)

    def test_default_horizon_columns(self):
        t = table()
        assert list(t.columns)[:2] == ["cohort", "size"]
        assert [c for c in t.columns if c.startswith("ltv_")] == ["ltv_0", "ltv_1", "ltv_2", "ltv_3"]
        assert math.isnan(t.loc[0, "retention_3"]) and math.isnan(t.loc[0, "ltv_3"])  # январь + 3 = апрель > март

    def test_censoring_is_nan_not_zero(self):
        t = cohort.build_cohorts(USERS, ORDERS, "2026-02-28", horizon=1)
        assert t["cohort"].tolist() == ["2026-01", "2026-02"]
        assert math.isnan(t.loc[1, "retention_1"]) and math.isnan(t.loc[1, "ltv_1"])
        assert t.loc[0, "retention_1"] == pytest.approx(0.5)

    def test_horizon_zero(self):
        t = table(horizon=0)
        assert list(t.columns) == ["cohort", "size", "retention_0", "ltv_0"]
        assert t["ltv_0"].tolist() == pytest.approx([20.0, 7.0, 4.0])

    def test_orders_before_signup_and_after_as_of_ignored(self):
        t = table(horizon=2)
        # 100 у b до регистрации, 99 у a после as_of, 50 у неизвестного пользователя не должны попасть
        assert t.loc[0, "ltv_2"] == pytest.approx(30.0)

    def test_signup_day_order_counts_and_late_signups_dropped(self):
        users = pd.DataFrame({"user_id": ["a", "z"], "signup_date": ["2026-01-31", "2026-05-01"]})
        orders = pd.DataFrame({"user_id": ["a", "a", "z"], "order_date": ["2026-01-31", "2026-02-01", "2026-05-02"],
                               "amount": [5.0, 6.0, 9.0]})
        t = cohort.build_cohorts(users, orders, "2026-03-01", horizon=1)
        assert len(t) == 1 and t.loc[0, "size"] == 1
        assert t.loc[0, "retention_0"] == 1.0 and t.loc[0, "retention_1"] == 1.0
        assert t.loc[0, "ltv_1"] == pytest.approx(11.0)

    def test_retention_counts_distinct_users(self):
        users = pd.DataFrame({"user_id": ["a", "b"], "signup_date": ["2026-01-01", "2026-01-02"]})
        orders = pd.DataFrame({"user_id": ["a", "a", "a"], "order_date": ["2026-01-03", "2026-01-04", "2026-01-05"],
                               "amount": [1.0, 1.0, 1.0]})
        t = cohort.build_cohorts(users, orders, "2026-01-31", horizon=0)
        assert t.loc[0, "retention_0"] == pytest.approx(0.5)
        assert t.loc[0, "ltv_0"] == pytest.approx(1.5)

    def test_empty_and_no_mutation(self):
        u0, o0 = USERS.copy(deep=True), ORDERS.copy(deep=True)
        e = cohort.build_cohorts(USERS, ORDERS, "2025-12-31", horizon=1)
        assert len(e) == 0
        assert list(e.columns) == ["cohort", "size", "retention_0", "retention_1", "ltv_0", "ltv_1"]
        pd.testing.assert_frame_equal(USERS, u0)
        pd.testing.assert_frame_equal(ORDERS, o0)

    def test_year_boundary(self):
        users = pd.DataFrame({"user_id": ["a"], "signup_date": ["2025-12-15"]})
        orders = pd.DataFrame({"user_id": ["a"], "order_date": ["2026-01-10"], "amount": [8.0]})
        t = cohort.build_cohorts(users, orders, "2026-02-01", horizon=2)
        assert t.loc[0, "cohort"] == "2025-12"
        assert t.loc[0, "retention_1"] == 1.0 and t.loc[0, "ltv_1"] == pytest.approx(8.0)
        assert t.loc[0, "ltv_2"] == pytest.approx(8.0)

    def test_datetime_inputs(self):
        users = USERS.assign(signup_date=pd.to_datetime(USERS["signup_date"]))
        orders = ORDERS.assign(order_date=pd.to_datetime(ORDERS["order_date"]))
        a = cohort.build_cohorts(users, orders, AS_OF, horizon=2)
        b = table(horizon=2)
        pd.testing.assert_frame_equal(a, b)


class TestCupedAdjust:
    def test_perfect_correlation(self):
        r = cohort.cuped_adjust([2, 4, 6, 8], [1, 2, 3, 4])
        assert r["theta"] == pytest.approx(2.0)
        np.testing.assert_allclose(r["adjusted"], [5.0] * 4)
        assert r["variance_reduction"] == pytest.approx(1.0)

    def test_mean_preserved_and_formula(self):
        rng = np.random.default_rng(7)
        x = rng.gamma(2.0, 10.0, 200)
        y = 0.6 * x + rng.normal(0, 3, 200)
        r = cohort.cuped_adjust(y, x)
        theta = np.cov(x, y, ddof=1)[0, 1] / np.var(x, ddof=1)
        assert r["theta"] == pytest.approx(theta)
        assert r["adjusted"].mean() == pytest.approx(y.mean())
        vr = 1 - np.var(r["adjusted"], ddof=1) / np.var(y, ddof=1)
        assert r["variance_reduction"] == pytest.approx(vr)
        assert vr > 0.5

    def test_degenerate_inputs(self):
        r = cohort.cuped_adjust([1.0, 2.0, 4.0], [5.0, 5.0, 5.0])
        assert r["theta"] == 0.0
        np.testing.assert_allclose(r["adjusted"], [1.0, 2.0, 4.0])
        assert r["variance_reduction"] == pytest.approx(0.0)
        r = cohort.cuped_adjust([3.0, 3.0, 3.0], [1.0, 2.0, 3.0])
        assert r["theta"] == pytest.approx(0.0) and r["variance_reduction"] == 0.0
        assert cohort.cuped_adjust([4.0], [2.0])["adjusted"].tolist() == [4.0]

    @pytest.mark.parametrize("y,x", [([1, 2], [1]), ([], []), ([1, float("nan")], [1, 2]),
                                    ([1, 2], [1, float("inf")]), ("ab", [1, 2])])
    def test_bad_input(self, y, x):
        with pytest.raises(ValueError, match="bad input"):
            cohort.cuped_adjust(y, x)


def make_ab(n=60, seed=11):
    rng = np.random.default_rng(seed)
    users, orders = [], []
    start = dt.date(2026, 3, 1)
    for i in range(n):
        g = "control" if i % 2 == 0 else "treatment"
        users.append({"user_id": f"u{i}", "signup_date": "2026-01-01", "group": g})
        base = rng.gamma(2.0, 10.0)
        for _ in range(rng.integers(0, 4)):
            d = start - dt.timedelta(days=int(rng.integers(1, 40)))
            orders.append({"user_id": f"u{i}", "order_date": d.isoformat(), "amount": round(base * rng.uniform(0.5, 1.5), 2)})
        for _ in range(rng.integers(0, 4)):
            d = start + dt.timedelta(days=int(rng.integers(0, 40)))
            amt = base * rng.uniform(0.5, 1.5) * (1.1 if g == "treatment" else 1.0)
            orders.append({"user_id": f"u{i}", "order_date": d.isoformat(), "amount": round(amt, 2)})
    return pd.DataFrame(users), pd.DataFrame(orders)


def slow_ab(users, orders, start, pre_days, post_days, alpha):
    s = dt.date.fromisoformat(start)
    pre = {u: 0.0 for u in users["user_id"]}
    post = dict(pre)
    for u, d, a in zip(orders["user_id"], orders["order_date"], orders["amount"]):
        if u not in pre:
            continue
        d = dt.date.fromisoformat(d)
        if s - dt.timedelta(days=pre_days) <= d < s:
            pre[u] += a
        elif s <= d < s + dt.timedelta(days=post_days):
            post[u] += a
    ids = list(users["user_id"])
    grp = dict(zip(users["user_id"], users["group"]))
    x = np.array([pre[i] for i in ids])
    y = np.array([post[i] for i in ids])
    dx = x - x.mean()
    theta = (dx * (y - y.mean())).sum() / (dx * dx).sum()
    adj = y - theta * dx
    c = np.array([grp[i] == "control" for i in ids])

    def cmp(v):
        a, b = v[c], v[~c]
        d = b.mean() - a.mean()
        se = math.sqrt(a.var(ddof=1) / a.size + b.var(ddof=1) / b.size)
        return d, se, math.erfc(abs(d / se) / math.sqrt(2))

    return theta, cmp(y), cmp(adj), (1 - adj.var(ddof=1) / y.var(ddof=1))


class TestAbLtv:
    def test_matches_independent_computation(self):
        users, orders = make_ab()
        r = cohort.ab_ltv(users, orders, "2026-03-01", pre_days=30, post_days=30, alpha=0.05)
        theta, raw, cup, vr = slow_ab(users, orders, "2026-03-01", 30, 30, 0.05)
        assert r["n"] == {"control": 30, "treatment": 30}
        assert r["theta"] == pytest.approx(theta)
        assert r["variance_reduction"] == pytest.approx(vr)
        for key, (d, se, p) in (("raw", raw), ("cuped", cup)):
            assert r[key]["diff"] == pytest.approx(d)
            assert r[key]["se"] == pytest.approx(se)
            assert r[key]["p_value"] == pytest.approx(p)
            assert r[key]["z"] == pytest.approx(d / se)
            assert r[key]["ci_low"] == pytest.approx(d - Z(0.975) * se)
            assert r[key]["ci_high"] == pytest.approx(d + Z(0.975) * se)
            assert r[key]["significant"] is (p < 0.05)
        assert r["cuped"]["se"] < r["raw"]["se"]

    def test_window_params_and_alpha(self):
        users, orders = make_ab()
        r = cohort.ab_ltv(users, orders, "2026-03-01", pre_days=10, post_days=15, alpha=0.2)
        theta, raw, cup, vr = slow_ab(users, orders, "2026-03-01", 10, 15, 0.2)
        assert r["theta"] == pytest.approx(theta)
        assert r["raw"]["diff"] == pytest.approx(raw[0])
        assert r["cuped"]["ci_high"] == pytest.approx(cup[0] + Z(0.9) * cup[1])

    def test_window_boundaries(self):
        users = pd.DataFrame({"user_id": ["a", "b"], "signup_date": ["2026-01-01"] * 2, "group": ["control", "treatment"]})
        orders = pd.DataFrame({
            "user_id": ["a", "a", "a", "a", "a", "b"],
            "order_date": ["2026-02-18", "2026-02-19", "2026-02-28", "2026-03-01", "2026-03-10", "2026-03-11"],
            "amount": [1000.0, 1.0, 2.0, 4.0, 8.0, 16.0],
        })
        # окна: pre [02-19, 03-01), post [03-01, 03-11); заказ 03-11 – вне окна
        r = cohort.ab_ltv(users, orders, "2026-03-01", pre_days=10, post_days=10)
        assert r["raw"]["mean_control"] == pytest.approx(12.0)
        assert r["raw"]["mean_treatment"] == pytest.approx(0.0)
        assert r["raw"]["diff"] == pytest.approx(-12.0)

    def test_no_mutation_and_unknown_users(self):
        users, orders = make_ab(20)
        extra = pd.concat([orders, pd.DataFrame([{"user_id": "ghost", "order_date": "2026-03-05", "amount": 9999.0}])],
                          ignore_index=True)
        u0, o0 = users.copy(deep=True), extra.copy(deep=True)
        a = cohort.ab_ltv(users, orders, "2026-03-01")
        b = cohort.ab_ltv(users, extra, "2026-03-01")
        assert a["raw"]["diff"] == pytest.approx(b["raw"]["diff"])
        pd.testing.assert_frame_equal(users, u0)
        pd.testing.assert_frame_equal(extra, o0)

    def test_zero_variance(self):
        users = pd.DataFrame({"user_id": ["a", "b"], "signup_date": ["2026-01-01"] * 2, "group": ["control", "treatment"]})
        orders = pd.DataFrame({"user_id": [], "order_date": [], "amount": []})
        r = cohort.ab_ltv(users, orders, "2026-03-01")
        assert r["raw"]["z"] == 0.0 and r["raw"]["p_value"] == 1.0 and r["raw"]["significant"] is False
        assert r["cuped"]["se"] == 0.0 and r["theta"] == 0.0 and r["variance_reduction"] == 0.0

    def test_empty_group(self):
        users, orders = make_ab(10)
        with pytest.raises(ValueError, match="empty group"):
            cohort.ab_ltv(users[users["group"] == "control"], orders, "2026-03-01")


class TestValidation:
    def test_missing_columns(self):
        with pytest.raises(ValueError, match="missing column: signup_date"):
            cohort.build_cohorts(USERS.drop(columns=["signup_date"]), ORDERS, AS_OF)
        with pytest.raises(ValueError, match="missing column: amount"):
            cohort.build_cohorts(USERS, ORDERS.drop(columns=["amount"]), AS_OF)
        with pytest.raises(ValueError, match="missing column: group"):
            cohort.ab_ltv(USERS, ORDERS, "2026-03-01")

    def test_bad_values(self):
        u = USERS.copy(); u.loc[1, "user_id"] = "a"
        with pytest.raises(ValueError, match="duplicate user_id"):
            cohort.build_cohorts(u, ORDERS, AS_OF)
        u = USERS.copy(); u.loc[0, "signup_date"] = "not-a-date"
        with pytest.raises(ValueError, match="bad date"):
            cohort.build_cohorts(u, ORDERS, AS_OF)
        o = ORDERS.copy(); o.loc[0, "amount"] = -1.0
        with pytest.raises(ValueError, match="bad amount"):
            cohort.build_cohorts(USERS, o, AS_OF)
        o = ORDERS.copy(); o.loc[0, "amount"] = float("nan")
        with pytest.raises(ValueError, match="bad amount"):
            cohort.build_cohorts(USERS, o, AS_OF)
        u = USERS.assign(group=["control", "treatment", "x", "control"])
        with pytest.raises(ValueError, match="bad group"):
            cohort.ab_ltv(u, ORDERS, "2026-03-01")

    @pytest.mark.parametrize("h", [-1, 1.5, "2", None])
    def test_bad_horizon(self, h):
        with pytest.raises(ValueError, match="bad horizon"):
            cohort.build_cohorts(USERS, ORDERS, AS_OF, horizon=h)

    @pytest.mark.parametrize("kw", [{"pre_days": 0}, {"post_days": 0}, {"pre_days": 2.5}, {"post_days": -3}])
    def test_bad_window(self, kw):
        users, orders = make_ab(10)
        with pytest.raises(ValueError, match="bad window"):
            cohort.ab_ltv(users, orders, "2026-03-01", **kw)


class TestDesign:
    def test_design_md_sections(self):
        path = os.path.join(os.path.dirname(os.path.abspath(cohort.__file__)), "DESIGN.md")
        assert os.path.exists(path), "нет DESIGN.md в корне репозитория"
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for h in ("Решения", "Компромиссы", "Границы применимости"):
            m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
            assert m is not None, h
            assert len(m.group(1).strip()) >= 200, h
