# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import math

import numpy as np
import pandas as pd
import pytest

import eda

COLS = ["user_id", "age", "city", "amount", "signup_date"]


def make(rows):
    return pd.DataFrame(rows, columns=COLS)


def row(uid="u1", age="30", city="msk", amount="10", date="2026-01-01"):
    return [uid, age, city, amount, date]


class TestInput:
    def test_does_not_mutate_input(self):
        df = make([row(uid=" u1 ", amount="1,5"), row(uid="u1", date="2026-02-01")])
        before = df.copy(deep=True)
        eda.clean(df)
        pd.testing.assert_frame_equal(df, before)

    def test_missing_column(self):
        for col in COLS:
            with pytest.raises(ValueError, match=f"missing column: {col}"):
                eda.clean(make([row()]).drop(columns=[col]))

    def test_extra_columns_dropped_and_layout(self):
        df = make([row(uid="b"), row(uid="a")])
        df["junk"] = 1
        cleaned, _ = eda.clean(df)
        assert list(cleaned.columns) == COLS + ["amount_outlier"]
        assert [cleaned[c].dtype.kind for c in cleaned.columns] == ["O", "f", "O", "f", "M", "b"]
        assert list(cleaned.index) == [0, 1]

    def test_empty_frame(self):
        cleaned, rep = eda.clean(make([]))
        assert len(cleaned) == 0 and list(cleaned.columns) == COLS + ["amount_outlier"]
        assert rep["rows_in"] == 0 and rep["rows_out"] == 0
        assert rep["age_median"] is None and rep["amount_bounds"] is None and rep["outliers"] == 0


class TestIdsAndDuplicates:
    def test_ids_are_trimmed_strings_and_missing_dropped(self):
        df = make([row(uid=7), row(uid=" a "), row(uid=None), row(uid="   "), row(uid=np.nan), row(uid="")])
        cleaned, rep = eda.clean(df)
        assert list(cleaned["user_id"]) == ["7", "a"]
        assert rep["dropped_no_id"] == 4 and rep["rows_in"] == 6

    def test_sorted_by_string_id(self):
        cleaned, _ = eda.clean(make([row(uid="u2"), row(uid="u10"), row(uid="u1")]))
        assert list(cleaned["user_id"]) == ["u1", "u10", "u2"]

    def test_latest_signup_wins_not_last_in_file(self):
        df = make([row(uid="a", amount="1", date="2026-03-01"), row(uid="a", amount="2", date="2026-01-01")])
        cleaned, rep = eda.clean(df)
        assert cleaned.loc[0, "amount"] == 1 and rep["duplicates_removed"] == 1

    def test_tie_goes_to_last_in_file(self):
        df = make([row(uid="a", amount="1"), row(uid="a", amount="2"), row(uid="a", amount="3")])
        cleaned, rep = eda.clean(df)
        assert cleaned.loc[0, "amount"] == 3 and rep["duplicates_removed"] == 2

    def test_nat_is_earliest(self):
        df = make([row(uid="a", amount="1", date="2026-01-01"), row(uid="a", amount="2", date="not a date")])
        cleaned, _ = eda.clean(df)
        assert cleaned.loc[0, "amount"] == 1

    def test_report_invariant(self):
        df = make([row(uid="a"), row(uid="a"), row(uid=None), row(uid="b")])
        _, rep = eda.clean(df)
        assert rep["rows_in"] == rep["dropped_no_id"] + rep["duplicates_removed"] + rep["rows_out"] == 4


class TestTypes:
    def test_age_rules_and_median_fill(self):
        df = make([row(uid="a", age="20"), row(uid="b", age=" 40 "), row(uid="c", age="x"), row(uid="d", age=-1),
                   row(uid="e", age=121), row(uid="f", age=120), row(uid="g", age=None), row(uid="h", age=0)])
        cleaned, rep = eda.clean(df)
        known = [20, 40, 120, 0]
        med = float(np.median(known))
        assert rep["age_median"] == med == 30.0
        assert rep["missing"]["age"] == 4
        ages = dict(zip(cleaned["user_id"], cleaned["age"]))
        assert ages["a"] == 20 and ages["f"] == 120 and ages["h"] == 0
        assert all(ages[k] == med for k in "cdeg")
        assert cleaned["age"].dtype == "float64"

    def test_all_ages_missing(self):
        cleaned, rep = eda.clean(make([row(uid="a", age="?"), row(uid="b", age=None)]))
        assert rep["age_median"] is None and rep["missing"]["age"] == 2
        assert cleaned["age"].isna().all()

    def test_amount_parsing_never_filled(self):
        df = make([row(uid="a", amount="1200,50"), row(uid="b", amount=" 7.25 "), row(uid="c", amount="1 200"),
                   row(uid="d", amount=""), row(uid="e", amount=None), row(uid="f", amount=3)])
        cleaned, rep = eda.clean(df)
        got = dict(zip(cleaned["user_id"], cleaned["amount"]))
        assert got["a"] == 1200.5 and got["b"] == 7.25 and got["f"] == 3
        assert all(math.isnan(got[k]) for k in "cde")
        assert rep["missing"]["amount"] == 3

    def test_dates_and_city(self):
        df = make([row(uid="a", city="  Санкт-Петербург "), row(uid="b", city="   "), row(uid="c", city=None),
                   row(uid="d", date="2026-13-40"), row(uid="e", date=" 2026-02-03 ")])
        cleaned, rep = eda.clean(df)
        c = cleaned.set_index("user_id")
        assert c.loc["a", "city"] == "санкт-петербург"
        assert c.loc["b", "city"] == "unknown" and c.loc["c", "city"] == "unknown"
        assert pd.isna(c.loc["d", "signup_date"]) and c.loc["e", "signup_date"] == pd.Timestamp("2026-02-03")
        assert rep["missing"]["city"] == 2 and rep["missing"]["signup_date"] == 1

    def test_missing_counted_after_dedupe(self):
        df = make([row(uid="a", amount=None, age=None, date="2026-01-01"), row(uid="a", amount="5", age="30", date="2026-02-01")])
        _, rep = eda.clean(df)
        assert rep["missing"] == {"age": 0, "city": 0, "amount": 0, "signup_date": 0}


class TestOutliers:
    def test_iqr_bounds_and_flags(self):
        amounts = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1000, -500]
        df = make([row(uid=f"u{i:02d}", amount=str(a)) for i, a in enumerate(amounts)])
        cleaned, rep = eda.clean(df)
        q1, q3 = np.percentile(amounts, [25, 75])
        lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        assert rep["amount_bounds"] == pytest.approx([lo, hi])
        flags = dict(zip(cleaned["amount"], cleaned["amount_outlier"]))
        assert flags[1000] and flags[-500] and not flags[10] and not flags[18]
        assert rep["outliers"] == 2 and cleaned["amount_outlier"].dtype == bool

    def test_bounds_inclusive(self):
        df = make([row(uid=f"u{i}", amount=a) for i, a in enumerate(["10", "10", "10", "10", "25"])])
        cleaned, rep = eda.clean(df)
        assert rep["amount_bounds"] == pytest.approx([10, 10])
        assert list(cleaned["amount_outlier"]) == [False, False, False, False, True]

    def test_missing_amount_is_not_outlier_and_all_missing(self):
        cleaned, rep = eda.clean(make([row(uid="a", amount=None), row(uid="b", amount="x")]))
        assert rep["amount_bounds"] is None and rep["outliers"] == 0
        assert not cleaned["amount_outlier"].any()

    def test_bounds_ignore_removed_duplicates(self):
        df = make([row(uid="a", amount="1000000", date="2026-01-01"), row(uid="a", amount="10", date="2026-02-01"),
                   row(uid="b", amount="11"), row(uid="c", amount="12"), row(uid="d", amount="13")])
        _, rep = eda.clean(df)
        assert rep["outliers"] == 0 and rep["amount_bounds"][1] < 100


class TestSummarize:
    def cleaned(self):
        rows = [
            row(uid="a", age="20", city="msk", amount="100"),
            row(uid="b", age="30", city="msk", amount="300.333"),
            row(uid="c", age="41", city="spb", amount="50"),
            row(uid="d", age="22", city="kzn", amount=None),
            row(uid="e", age="33", city="nsk", amount="50"),
            row(uid="f", age="40", city="msk", amount="9000"),
        ]
        return eda.clean(make(rows))[0]

    def test_values_and_order(self):
        s = eda.summarize(self.cleaned())
        assert list(s["city"]) == ["msk", "nsk", "spb", "kzn"]  # 9400.33, затем 50 = 50 по имени, затем 0
        msk = s.set_index("city").loc["msk"]
        assert msk["users"] == 3 and msk["mean_age"] == 30.0
        assert msk["total_amount"] == 9400.33 and msk["median_amount"] == 300.33
        assert list(s.index) == [0, 1, 2, 3]

    def test_empty_amounts_city_and_outliers(self):
        s = eda.summarize(self.cleaned()).set_index("city")
        assert s.loc["kzn", "total_amount"] == 0.0 and math.isnan(s.loc["kzn", "median_amount"])
        assert s["outliers"].sum() >= 1 and s.loc["msk", "outliers"] == 1
        assert s["users"].dtype.kind == "i"

    def test_empty(self):
        s = eda.summarize(eda.clean(make([]))[0])
        assert len(s) == 0 and list(s.columns) == ["city", "users", "mean_age", "total_amount", "median_amount", "outliers"]
