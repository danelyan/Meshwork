# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import math

import numpy as np
import pandas as pd
import pytest

import cohort

USERS = pd.DataFrame({"user_id": ["a", "b", "c"], "signup_date": ["2026-01-10", "2026-01-20", "2026-02-05"]})
ORDERS = pd.DataFrame({
    "user_id": ["a", "a", "b", "c"],
    "order_date": ["2026-01-12", "2026-02-03", "2026-01-25", "2026-02-06"],
    "amount": [10.0, 20.0, 30.0, 7.0],
})


def test_cohort_table_and_censoring():
    t = cohort.build_cohorts(USERS, ORDERS, "2026-02-28", horizon=2)
    assert list(t.columns) == ["cohort", "size", "retention_0", "retention_1", "retention_2",
                               "ltv_0", "ltv_1", "ltv_2"]
    jan, feb = t.iloc[0], t.iloc[1]
    assert jan["cohort"] == "2026-01" and jan["size"] == 2
    assert jan["retention_0"] == pytest.approx(1.0) and jan["retention_1"] == pytest.approx(0.5)
    assert jan["ltv_1"] == pytest.approx(30.0)
    assert math.isnan(jan["retention_2"]) and math.isnan(jan["ltv_2"])
    assert feb["ltv_0"] == pytest.approx(7.0) and math.isnan(feb["ltv_1"])


def test_cuped_theta():
    r = cohort.cuped_adjust([1, 3, 2, 5], [1, 2, 3, 4])
    assert r["theta"] == pytest.approx(1.1)
    assert np.mean(r["adjusted"]) == pytest.approx(2.75)
    assert 0 < r["variance_reduction"] < 1


def test_ab_ltv_shape():
    users = pd.DataFrame({"user_id": list("abcd"), "signup_date": ["2026-01-01"] * 4,
                          "group": ["control", "control", "treatment", "treatment"]})
    orders = pd.DataFrame({"user_id": list("abcd"), "order_date": ["2026-03-05"] * 4, "amount": [1.0, 2.0, 3.0, 4.0]})
    r = cohort.ab_ltv(users, orders, "2026-03-01")
    assert r["n"] == {"control": 2, "treatment": 2}
    assert r["raw"]["diff"] == pytest.approx(2.0)


def test_bad_horizon():
    with pytest.raises(ValueError, match="bad horizon"):
        cohort.build_cohorts(USERS, ORDERS, "2026-02-28", horizon=-1)
