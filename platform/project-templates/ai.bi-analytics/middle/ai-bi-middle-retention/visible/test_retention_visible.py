# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pandas as pd
import pytest

import retention as rt


def ev(rows):
    return pd.DataFrame(rows, columns=["user_id", "event", "ts"])


ROWS = [
    ["u1", "signup", "2026-01-05"], ["u1", "activate", "2026-01-06"], ["u1", "purchase", "2026-01-09"],
    ["u1", "visit", "2026-01-13"],
    ["u2", "signup", "2026-01-06"], ["u2", "visit", "2026-01-20"],
    ["u2", "visit", "2026-01-20"],
    ["u3", "signup", "2026-01-07"], ["u3", "activate", "2026-01-20"],
    ["u4", "login", "2026-01-07"], ["u5", "visit", "2099-01-01"],
]


def test_quality_report():
    clean, rep = rt.check_events(ev(ROWS), "2026-02-01")
    assert rep["unknown_event"] == 1 and rep["future"] == 1 and rep["duplicates"] == 1
    assert rep["rows_in"] == rep["rows_out"] + 3 == len(ROWS)
    assert len(clean) == rep["rows_out"]


def test_retention_week_zero_and_censoring():
    r = rt.weekly_retention(ev(ROWS), "2026-01-14", weeks=3)
    assert list(r["cohort"]) == ["2026-01-05"] and list(r["size"]) == [3]
    assert r.loc[0, "week_0"] == 1.0 and r.loc[0, "week_1"] == 0.3333
    assert pd.isna(r.loc[0, "week_2"])


def test_funnel_window():
    f = rt.funnel(ev(ROWS), "2026-02-01")
    assert list(f["users"]) == [3, 1, 1] and list(f["step"]) == ["signup", "activate", "purchase"]
    assert f.loc[1, "from_prev"] == 0.3333


def test_bad_as_of():
    with pytest.raises(ValueError, match="bad as_of"):
        rt.check_events(ev(ROWS), "yesterday")
