# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pandas as pd
import pytest

import eda


def frame():
    return pd.DataFrame({
        "user_id": ["u1", "u2", "u2", " ", "u3"],
        "age": ["30", "x", "41", "20", "200"],
        "city": [" Moscow ", "KAZAN", "kazan", "Moscow", ""],
        "amount": ["100,5", "50", "70", "10", None],
        "signup_date": ["2026-01-01", "2026-01-02", "2026-02-01", "2026-01-05", "bad"],
    })


def test_report_counts():
    cleaned, rep = eda.clean(frame())
    assert (rep["rows_in"], rep["dropped_no_id"], rep["duplicates_removed"], rep["rows_out"]) == (5, 1, 1, 3)
    assert list(cleaned["user_id"]) == ["u1", "u2", "u3"]


def test_types_and_latest_duplicate_wins():
    cleaned, _ = eda.clean(frame())
    row = cleaned.set_index("user_id")
    assert row.loc["u2", "amount"] == 70 and row.loc["u1", "amount"] == 100.5
    assert row.loc["u1", "city"] == "moscow" and row.loc["u3", "city"] == "unknown"
    assert str(cleaned["signup_date"].dtype) == "datetime64[ns]" and pd.isna(row.loc["u3", "signup_date"])


def test_missing_column():
    with pytest.raises(ValueError, match="missing column: amount"):
        eda.clean(frame().drop(columns=["amount"]))


def test_summarize_columns():
    cleaned, _ = eda.clean(frame())
    s = eda.summarize(cleaned)
    assert list(s.columns) == ["city", "users", "mean_age", "total_amount", "median_amount", "outliers"]
    assert list(s["city"]) == ["moscow", "kazan", "unknown"]
