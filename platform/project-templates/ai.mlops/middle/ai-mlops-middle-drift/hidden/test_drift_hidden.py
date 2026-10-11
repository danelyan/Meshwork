# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import copy
import math

import numpy as np
import pytest

from drift import drift_report, ks_statistic, psi, psi_categorical, severity


def test_psi_identical_samples_zero():
    xs = [0.5, 1.5, 2.5, 3.5, 4.5, 9.0]
    assert psi(xs, list(xs), bins=3) == pytest.approx(0.0, abs=1e-12)


def test_psi_known_value_two_bins():
    expected = 0.25 * math.log(1.5) + 0.25 * math.log(2)
    assert psi([0, 1, 2, 3], [0, 0, 0, 3], bins=2) == pytest.approx(expected)


def test_psi_empty_bin_uses_eps_and_stays_finite():
    eps = 1e-4
    got = psi([0, 1, 2, 3], [3, 3, 3, 3], bins=2, eps=eps)
    want = (eps - 0.5) * math.log(eps / 0.5) + (1 - 0.5) * math.log(1 / 0.5)
    assert math.isfinite(got)
    assert got == pytest.approx(want)


def test_psi_custom_eps_changes_result():
    a = psi([0, 1, 2, 3], [3, 3, 3, 3], bins=2, eps=1e-4)
    b = psi([0, 1, 2, 3], [3, 3, 3, 3], bins=2, eps=1e-2)
    assert a != pytest.approx(b)
    want = (1e-2 - 0.5) * math.log(1e-2 / 0.5) + 0.5 * math.log(2)
    assert b == pytest.approx(want)


def test_psi_clips_out_of_range_actual_values():
    # 100 и -50 лежат вне диапазона эталона и попадают в крайние бины
    got = psi([0, 1, 2, 3], [-50, 100, 100, -50], bins=2)
    assert got == pytest.approx(0.0, abs=1e-12)


def test_psi_constant_reference_single_bin():
    assert psi([5, 5, 5], [1, 5, 9]) == pytest.approx(0.0, abs=1e-12)


def test_psi_ignores_missing_and_accepts_numpy():
    base = psi([0, 1, 2, 3], [0, 0, 0, 3], bins=2)
    with_nan = psi(np.array([0, 1, np.nan, 2, 3]), [0, None, 0, 0, float("nan"), 3], bins=2)
    assert with_nan == pytest.approx(base)


@pytest.mark.parametrize("args,kwargs", [
    (([], [1]), {}), (([1], []), {}), (([None, float("nan")], [1]), {}),
    (([1], [1]), {"bins": 0}), (([1], [1]), {"eps": 0}),
])
def test_psi_value_errors(args, kwargs):
    with pytest.raises(ValueError):
        psi(*args, **kwargs)


def test_psi_does_not_mutate_inputs():
    e, a = [3.0, 1.0, 2.0, 0.0], [0.0, 3.0, None]
    e0, a0 = list(e), list(a)
    psi(e, a, bins=2)
    assert (e, a) == (e0, a0)


def test_psi_categorical_new_and_vanished_categories():
    eps = 1e-4
    got = psi_categorical(["a", "a", "b", "b"], ["a", "c", "c", "c"])
    want = (
        (0.25 - 0.5) * math.log(0.25 / 0.5)
        + (eps - 0.5) * math.log(eps / 0.5)          # b исчезла
        + (0.75 - eps) * math.log(0.75 / eps)        # c новая
    )
    assert got == pytest.approx(want)


def test_psi_categorical_order_independent_and_identical_zero():
    e, a = ["x", "y", "y", 1, 1, 1], [1, "y", "x", "x", 1, "y"]
    assert psi_categorical(e, a) == pytest.approx(psi_categorical(list(reversed(e)), list(reversed(a))))
    assert psi_categorical(e, list(e)) == pytest.approx(0.0, abs=1e-12)
    with pytest.raises(ValueError):
        psi_categorical([], ["a"])


def test_ks_known_values_and_ties():
    assert ks_statistic([1, 2, 3], [1, 2, 3]) == 0.0
    assert ks_statistic([1, 2, 3], [10, 11]) == pytest.approx(1.0)
    assert ks_statistic([1, 2, 3], [2, 3, 4]) == pytest.approx(1 / 3)
    assert ks_statistic([1, 1, 2], [1, 2, 2]) == pytest.approx(1 / 3)
    assert ks_statistic([1, 1, 1], [1, 1, 1, 1]) == 0.0
    assert ks_statistic([1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8]) == pytest.approx(0.5)


def test_ks_symmetric_ignores_missing_and_errors():
    a, b = [0.1, 0.4, 0.4, 0.9], [0.2, 0.3, 0.8, 1.5, 2.0]
    assert ks_statistic(a, b) == pytest.approx(ks_statistic(b, a))
    assert ks_statistic([1, None, 2], np.array([1, 2, np.nan])) == 0.0
    with pytest.raises(ValueError):
        ks_statistic([], [1])


def test_severity_boundaries():
    assert severity(0.0999, 0.1, 0.25) == "ok"
    assert severity(0.1, 0.1, 0.25) == "warn"
    assert severity(0.2499, 0.1, 0.25) == "warn"
    assert severity(0.25, 0.1, 0.25) == "alert"
    assert severity(0.3, 0.2, 0.2) == "alert"
    with pytest.raises(ValueError):
        severity(0.1, 0.5, 0.2)


REF = {
    "age": list(range(100)),
    "country": ["ru"] * 60 + ["kz"] * 30 + ["by"] * 10,
    "flag": [True, False] * 50,
}


def window(name, **data):
    return {"name": name, "data": data}


def test_report_structure_order_and_types():
    rep = drift_report(REF, [
        window("w1", age=list(range(100)), country=["ru"] * 60 + ["kz"] * 30 + ["by"] * 10, flag=[True, False] * 50),
        window("w2", age=list(range(100)), country=["ru"] * 60 + ["kz"] * 30 + ["by"] * 10, flag=[True, False] * 50),
    ])
    assert [w["window"] for w in rep["windows"]] == ["w1", "w2"]
    feats = rep["windows"][0]["features"]
    assert list(feats) == ["age", "country", "flag"]
    assert feats["age"]["type"] == "numeric" and feats["age"]["ks"] == pytest.approx(0.0)
    assert feats["country"]["type"] == "categorical" and feats["country"]["ks"] is None
    assert feats["flag"]["type"] == "categorical"      # bool – не числовой
    assert rep["windows"][0]["status"] == "ok"
    assert rep["summary"] == {"alert_windows": [], "first_alert": None}


def test_report_matches_building_blocks():
    shifted = [x + 30 for x in range(100)]
    rep = drift_report({"age": REF["age"]}, [window("w", age=shifted)])
    f = rep["windows"][0]["features"]["age"]
    assert f["psi"] == pytest.approx(psi(REF["age"], shifted))
    assert f["ks"] == pytest.approx(ks_statistic(REF["age"], shifted))
    assert f["status"] == "alert"


def test_report_new_category_triggers_alert():
    rep = drift_report({"country": REF["country"]}, [window("w", country=["ru"] * 50 + ["xx"] * 50)])
    f = rep["windows"][0]["features"]["country"]
    assert f["status"] == "alert" and f["psi"] > 0.25
    assert rep["windows"][0]["status"] == "alert"


def test_report_status_is_worst_of_psi_and_ks_with_custom_thresholds():
    shifted = [x + 12 for x in range(100)]
    default = drift_report({"age": REF["age"]}, [window("w", age=shifted)])["windows"][0]["features"]["age"]
    strict = drift_report({"age": REF["age"]}, [window("w", age=shifted)],
                          thresholds={"ks_warn": 0.01, "ks_alert": 0.02, "psi_warn": 9, "psi_alert": 10})
    assert strict["windows"][0]["features"]["age"]["status"] == "alert"     # решает KS
    lax = drift_report({"age": REF["age"]}, [window("w", age=shifted)],
                       thresholds={"ks_warn": 5, "ks_alert": 6, "psi_warn": 0.0, "psi_alert": 0.0001})
    assert lax["windows"][0]["features"]["age"]["status"] == "alert"        # решает PSI
    assert default["psi"] == pytest.approx(strict["windows"][0]["features"]["age"]["psi"])


def test_report_custom_bins():
    shifted = [x + 12 for x in range(100)]
    a = drift_report({"age": REF["age"]}, [window("w", age=shifted)], thresholds={"bins": 4})
    assert a["windows"][0]["features"]["age"]["psi"] == pytest.approx(psi(REF["age"], shifted, bins=4))


def test_report_missing_feature_and_all_missing_values():
    rep = drift_report({"age": REF["age"], "country": REF["country"]}, [
        window("w1", age=list(range(100))),
        window("w2", age=[None, float("nan")], country=[None]),
        window("w3"),
    ])
    w1, w2, w3 = rep["windows"]
    assert w1["features"]["country"] == {"type": "categorical", "psi": None, "ks": None, "status": "no_data"}
    assert w1["status"] == "ok"                       # no_data не влияет на статус окна
    assert w2["status"] == "no_data" and w3["status"] == "no_data"
    assert w2["features"]["age"]["psi"] is None
    assert rep["summary"]["alert_windows"] == []


def test_report_first_alert_and_alert_list_in_input_order():
    ok = list(range(100))
    bad = [x + 80 for x in range(100)]
    rep = drift_report({"x": ok}, [window("a", x=ok), window("b", x=bad), window("c", x=ok), window("d", x=bad)])
    assert rep["summary"] == {"alert_windows": ["b", "d"], "first_alert": "b"}


def test_report_ignores_unknown_window_features_and_empty_windows():
    rep = drift_report({"x": [1, 2, 3]}, [window("w", x=[1, 2, 3], extra=[1])])
    assert list(rep["windows"][0]["features"]) == ["x"]
    assert drift_report({"x": [1, 2, 3]}, []) == {"windows": [], "summary": {"alert_windows": [], "first_alert": None}}


def test_report_does_not_mutate_inputs():
    ref = {"x": [3.0, None, 1.0, 2.0], "c": ["a", "b", None]}
    wins = [window("w", x=[2.0, 5.0], c=["a", "z"])]
    ref0, wins0 = copy.deepcopy(ref), copy.deepcopy(wins)
    drift_report(ref, wins)
    assert ref == ref0 and wins == wins0


def test_report_errors():
    with pytest.raises(ValueError):
        drift_report({"x": []}, [])
    with pytest.raises(ValueError):
        drift_report({"x": [None]}, [])
    with pytest.raises(ValueError):
        drift_report({"x": [1]}, [{"data": {"x": [1]}}])
    with pytest.raises(ValueError):
        drift_report({"x": [1]}, [{"name": "w"}])
    with pytest.raises(ValueError):
        drift_report({"x": [1]}, [], thresholds={"nope": 1})
