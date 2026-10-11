# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import math

import pytest

from drift import drift_report, ks_statistic, psi, psi_categorical, severity


def test_psi_known_value():
    # доли эталона 0.5/0.5, окна 0.75/0.25
    expected = 0.25 * math.log(1.5) + 0.25 * math.log(2)
    assert psi([0, 1, 2, 3], [0, 0, 0, 3], bins=2) == pytest.approx(expected)


def test_psi_identical_is_zero_and_ks_known():
    assert psi([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]) == pytest.approx(0.0)
    assert ks_statistic([1, 2, 3], [2, 3, 4]) == pytest.approx(1 / 3)


def test_new_category_gives_large_psi():
    assert psi_categorical(["a", "b"] * 10, ["a", "b"] * 5 + ["z"] * 10) > 0.25


def test_report_flags_shifted_window():
    ref = {"x": list(range(100))}
    windows = [
        {"name": "w1", "data": {"x": list(range(100))}},
        {"name": "w2", "data": {"x": list(range(60, 160))}},
    ]
    rep = drift_report(ref, windows)
    assert [w["status"] for w in rep["windows"]] == ["ok", "alert"]
    assert rep["summary"] == {"alert_windows": ["w2"], "first_alert": "w2"}
    assert severity(0.2, 0.1, 0.25) == "warn"
