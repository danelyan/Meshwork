# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import math

import numpy as np
import pandas as pd
import pytest

import retention as rt

ISSUES = ["no_user", "bad_ts", "unknown_event", "future", "duplicates"]


def ev(rows):
    return pd.DataFrame(rows, columns=["user_id", "event", "ts"])


class TestCheckEvents:
    def test_missing_column_and_as_of(self):
        for c in ("user_id", "event", "ts"):
            with pytest.raises(ValueError, match=f"missing column: {c}"):
                rt.check_events(ev([["u", "signup", "2026-01-01"]]).drop(columns=[c]), "2026-02-01")
        for bad in ("2026-13-01", "x", "01.02.2026", None):
            with pytest.raises(ValueError, match="bad as_of"):
                rt.check_events(ev([["u", "signup", "2026-01-01"]]), bad)

    def test_does_not_mutate(self):
        df = ev([[" u ", "SignUp", "2026-01-01"], ["u", "signup", "2026-01-01"]])
        before = df.copy(deep=True)
        rt.check_events(df, "2026-02-01")
        pd.testing.assert_frame_equal(df, before)

    def test_layout_and_normalization(self):
        df = ev([[" b ", " SIGNUP ", "2026-01-02"], [7, "visit", "2026-01-01 10:30:00"], ["a", "signup", "2026-01-02"]])
        df["junk"] = 1
        clean, rep = rt.check_events(df, "2026-02-01")
        assert list(clean.columns) == ["user_id", "event", "ts"]
        assert [clean[c].dtype.kind for c in clean.columns] == ["O", "O", "M"]
        assert list(clean["user_id"]) == ["7", "a", "b"] and list(clean["event"]) == ["visit", "signup", "signup"]
        assert list(clean.index) == [0, 1, 2]
        assert rep["rows_in"] == 3 and rep["rows_out"] == 3

    def test_each_category_counted(self):
        df = ev([
            [None, "signup", "2026-01-01"], ["  ", "signup", "2026-01-01"], [np.nan, "visit", "2026-01-01"],
            ["u1", "signup", "garbage"], ["u1", "signup", None],
            ["u1", "login", "2026-01-01"], ["u1", None, "2026-01-01"],
            ["u1", "visit", "2026-03-01"], ["u1", "visit", "2026-02-02 00:00:00"],
            ["u1", "visit", "2026-01-01"], ["u1", "VISIT", "2026-01-01 00:00:00"], ["u1", "visit", "2026-01-01"],
            ["u1", "signup", "2026-02-01 23:59:59"],
        ])
        clean, rep = rt.check_events(df, "2026-02-01")
        assert (rep["no_user"], rep["bad_ts"], rep["unknown_event"], rep["future"], rep["duplicates"]) == (3, 2, 2, 2, 2)
        assert rep["rows_in"] == 13 and rep["rows_out"] == 2
        assert rep["rows_in"] == rep["rows_out"] + sum(rep[k] for k in ISSUES)

    def test_priority_first_category_wins(self):
        # пустой пользователь с битой датой и неизвестным событием — только no_user
        _, rep = rt.check_events(ev([["", "weird", "bad"], ["u", "weird", "bad"], ["u", "weird", "2099-01-01"]]), "2026-02-01")
        assert (rep["no_user"], rep["bad_ts"], rep["unknown_event"], rep["future"]) == (1, 1, 1, 0)

    def test_as_of_day_inclusive_end(self):
        _, rep = rt.check_events(ev([["u", "visit", "2026-02-01 23:59:59"], ["u", "visit", "2026-02-02 00:00:00"]]), "2026-02-01")
        assert rep["future"] == 1 and rep["rows_out"] == 1

    def test_duplicates_after_normalization_keep_first(self):
        clean, rep = rt.check_events(ev([[" u", "Visit", "2026-01-01"], ["u", "visit", "2026-01-01 00:00:00"]]), "2026-02-01")
        assert rep["duplicates"] == 1 and len(clean) == 1

    def test_same_user_event_different_time_not_duplicate(self):
        _, rep = rt.check_events(ev([["u", "visit", "2026-01-01 10:00:00"], ["u", "visit", "2026-01-01 11:00:00"]]), "2026-02-01")
        assert rep["duplicates"] == 0

    def test_sorted_by_ts_user_event(self):
        clean, _ = rt.check_events(ev([["b", "visit", "2026-01-02"], ["a", "visit", "2026-01-02"], ["z", "activate", "2026-01-01"], ["a", "signup", "2026-01-02"]]), "2026-02-01")
        assert list(zip(clean["user_id"], clean["event"])) == [("z", "activate"), ("a", "signup"), ("a", "visit"), ("b", "visit")]

    def test_user_flags(self):
        df = ev([
            ["a", "signup", "2026-01-01"], ["a", "visit", "2026-01-02"],        # норма
            ["b", "visit", "2026-01-01"], ["b", "signup", "2026-01-03"],        # signup позже активности
            ["c", "visit", "2026-01-01"],                                         # нет signup
            ["d", "activate", "2026-01-01"], ["d", "visit", "2026-01-02"],       # нет signup
        ])
        _, rep = rt.check_events(df, "2026-02-01")
        assert rep["users_without_signup"] == 2 and rep["signup_after_activity"] == 1

    def test_empty(self):
        clean, rep = rt.check_events(ev([]), "2026-02-01")
        assert len(clean) == 0 and list(clean.columns) == ["user_id", "event", "ts"]
        assert rep["rows_in"] == 0 and rep["rows_out"] == 0 and rep["users_without_signup"] == 0 and rep["signup_after_activity"] == 0
        assert set(rep) == {"rows_in", "rows_out", "users_without_signup", "signup_after_activity", *ISSUES}


class TestRetention:
    def rows(self):
        # пн 2026-01-05; когорта A: u1,u2; пн 2026-01-12; когорта B: u3
        return [
            ["u1", "signup", "2026-01-05 09:00:00"], ["u1", "visit", "2026-01-12"], ["u1", "visit", "2026-01-26"],
            ["u2", "signup", "2026-01-11 23:59:00"], ["u2", "visit", "2026-01-19"],
            ["u3", "signup", "2026-01-12"], ["u3", "visit", "2026-01-13"],
        ]

    def test_layout(self):
        r = rt.weekly_retention(ev(self.rows()), "2026-02-28", weeks=2)
        assert list(r.columns) == ["cohort", "size", "week_0", "week_1", "week_2"]
        assert list(r["cohort"]) == ["2026-01-05", "2026-01-12"] and list(r["size"]) == [2, 1]
        assert list(r.index) == [0, 1]

    def test_values(self):
        r = rt.weekly_retention(ev(self.rows()), "2026-02-28", weeks=3)
        assert list(r["week_0"]) == [1.0, 1.0]
        assert list(r["week_1"]) == [0.5, 0.0]
        assert list(r["week_2"]) == [0.5, 0.0]
        assert list(r["week_3"]) == [0.5, 0.0]

    def test_sunday_signup_belongs_to_previous_monday_week(self):
        r = rt.weekly_retention(ev([["u", "signup", "2026-01-11 23:59:00"], ["u", "visit", "2026-01-12"]]), "2026-03-01", weeks=1)
        assert list(r["cohort"]) == ["2026-01-05"] and list(r["week_1"]) == [1.0]

    def test_censoring_is_nan_not_zero(self):
        r = rt.weekly_retention(ev(self.rows()), "2026-01-19", weeks=3)
        a, b = r.iloc[0], r.iloc[1]
        # когорта A (05.01): окна 0 (05.01), 1 (12.01), 2 (19.01) наблюдаемы, окно 3 (26.01) — нет
        assert a["week_2"] == 0.5 and math.isnan(a["week_3"])
        # когорта B (12.01): окна 0, 1 (19.01) наблюдаемы, окно 2 (26.01) — нет
        assert b["week_1"] == 0.0 and math.isnan(b["week_2"]) and math.isnan(b["week_3"])

    def test_as_of_partial_week_observed(self):
        r = rt.weekly_retention(ev([["u", "signup", "2026-01-05"]]), "2026-01-12", weeks=2)
        assert r.loc[0, "week_1"] == 0.0 and math.isnan(r.loc[0, "week_2"])
        r = rt.weekly_retention(ev([["u", "signup", "2026-01-05"]]), "2026-01-11", weeks=2)
        assert math.isnan(r.loc[0, "week_1"])

    def test_cleaning_is_applied(self):
        rows = self.rows() + [["u1", "visit", "2026-01-12"], ["u1", "login", "2026-02-02"], ["u1", "visit", "2099-01-01"], ["ghost", "visit", "2026-01-13"]]
        a = rt.weekly_retention(ev(rows), "2026-02-28", weeks=3)
        b = rt.weekly_retention(ev(self.rows()), "2026-02-28", weeks=3)
        pd.testing.assert_frame_equal(a, b)

    def test_users_without_signup_excluded(self):
        r = rt.weekly_retention(ev([["a", "visit", "2026-01-05"], ["b", "signup", "2026-01-06"]]), "2026-02-01", weeks=1)
        assert list(r["size"]) == [1]

    def test_first_signup_defines_cohort(self):
        r = rt.weekly_retention(ev([["u", "signup", "2026-01-13"], ["u", "signup", "2026-01-05"]]), "2026-03-01", weeks=1)
        assert list(r["cohort"]) == ["2026-01-05"] and list(r["size"]) == [1]

    def test_activity_counted_once_per_user_and_week(self):
        rows = [["u", "signup", "2026-01-05"]] + [["u", "visit", f"2026-01-1{d}"] for d in (2, 3, 4)] + [["v", "signup", "2026-01-05"]]
        r = rt.weekly_retention(ev(rows), "2026-03-01", weeks=1)
        assert r.loc[0, "week_1"] == 0.5

    def test_weeks_zero_and_bad_weeks(self):
        r = rt.weekly_retention(ev(self.rows()), "2026-02-28", weeks=0)
        assert list(r.columns) == ["cohort", "size", "week_0"]
        for bad in (-1, 1.5, "3", None, True):
            with pytest.raises(ValueError, match="bad weeks"):
                rt.weekly_retention(ev(self.rows()), "2026-02-28", weeks=bad)

    def test_rounding(self):
        rows = [[f"u{i}", "signup", "2026-01-05"] for i in range(3)] + [["u0", "visit", "2026-01-13"]]
        assert rt.weekly_retention(ev(rows), "2026-03-01", weeks=1).loc[0, "week_1"] == 0.3333

    def test_empty(self):
        r = rt.weekly_retention(ev([["u", "visit", "2026-01-01"]]), "2026-02-01", weeks=2)
        assert len(r) == 0 and list(r.columns) == ["cohort", "size", "week_0", "week_1", "week_2"]


class TestFunnel:
    def test_chain_and_window(self):
        rows = [
            ["a", "signup", "2026-01-01"], ["a", "activate", "2026-01-02"], ["a", "purchase", "2026-01-08"],   # ровно 7 дней - в окне
            ["b", "signup", "2026-01-01"], ["b", "activate", "2026-01-02"], ["b", "purchase", "2026-01-09"],   # 8 дней - вне
            ["c", "signup", "2026-01-01"], ["c", "purchase", "2026-01-02"],                                      # без activate
            ["d", "activate", "2026-01-01"], ["d", "purchase", "2026-01-02"],                                    # без signup
            ["e", "signup", "2026-01-01"],
        ]
        f = rt.funnel(ev(rows), "2026-03-01")
        assert list(f.columns) == ["step", "users", "from_prev", "from_start"]
        assert list(f["step"]) == ["signup", "activate", "purchase"]
        assert list(f["users"]) == [4, 2, 1]
        assert list(f["from_prev"]) == [1.0, 0.5, 0.5]
        assert list(f["from_start"]) == [1.0, 0.5, 0.25]
        assert list(f.index) == [0, 1, 2]

    def test_order_matters(self):
        rows = [["a", "signup", "2026-01-03"], ["a", "activate", "2026-01-01"]]
        assert list(rt.funnel(ev(rows), "2026-03-01")["users"]) == [1, 0, 0]

    def test_time_of_day_orders_same_day(self):
        ok = [["a", "signup", "2026-01-01 10:00:00"], ["a", "activate", "2026-01-01 11:00:00"]]
        bad = [["a", "signup", "2026-01-01 10:00:00"], ["a", "activate", "2026-01-01 09:00:00"]]
        assert list(rt.funnel(ev(ok), "2026-03-01")["users"]) == [1, 1, 0]
        assert list(rt.funnel(ev(bad), "2026-03-01")["users"]) == [1, 0, 0]

    def test_earliest_valid_event_chosen_greedy(self):
        # ранний activate до signup не считается; берётся первый activate после signup
        rows = [["a", "activate", "2026-01-01"], ["a", "signup", "2026-01-03"], ["a", "activate", "2026-01-04"], ["a", "purchase", "2026-01-05"]]
        assert list(rt.funnel(ev(rows), "2026-03-01")["users"]) == [1, 1, 1]

    def test_first_signup_anchors_window(self):
        rows = [["a", "signup", "2026-01-01"], ["a", "signup", "2026-01-20"], ["a", "activate", "2026-01-21"]]
        assert list(rt.funnel(ev(rows), "2026-03-01")["users"]) == [1, 0, 0]

    def test_window_zero(self):
        rows = [["a", "signup", "2026-01-01 10:00:00"], ["a", "activate", "2026-01-01 10:00:00"], ["b", "signup", "2026-01-01"], ["b", "activate", "2026-01-02"]]
        assert list(rt.funnel(ev(rows), "2026-03-01", window_days=0)["users"]) == [2, 1, 0]

    def test_custom_steps(self):
        rows = [["a", "signup", "2026-01-01"], ["a", "purchase", "2026-01-02"]]
        f = rt.funnel(ev(rows), "2026-03-01", steps=("signup", "purchase"))
        assert list(f["step"]) == ["signup", "purchase"] and list(f["users"]) == [1, 1]
        f = rt.funnel(ev(rows), "2026-03-01", steps=["visit", "purchase"])
        assert list(f["users"]) == [0, 0] and list(f["from_prev"]) == [1.0, 0.0] and list(f["from_start"]) == [1.0, 0.0]

    def test_cleaning_is_applied(self):
        rows = [["a", "signup", "2026-01-01"], ["a", "activate", "2099-01-01"], ["a", "activate", "bad"], ["a", "purchase", "2026-01-02"]]
        assert list(rt.funnel(ev(rows), "2026-03-01")["users"]) == [1, 0, 0]

    def test_rounding(self):
        rows = [[f"u{i}", "signup", "2026-01-01"] for i in range(3)] + [["u0", "activate", "2026-01-02"]]
        f = rt.funnel(ev(rows), "2026-03-01")
        assert f.loc[1, "from_prev"] == 0.3333 and f.loc[1, "from_start"] == 0.3333

    def test_bad_arguments(self):
        rows = [["a", "signup", "2026-01-01"]]
        for bad in ((), ("signup", "signup"), ("signup", "login")):
            with pytest.raises(ValueError, match="bad steps"):
                rt.funnel(ev(rows), "2026-03-01", steps=bad)
        for bad in (-1, 2.5, "7", None):
            with pytest.raises(ValueError, match="bad window"):
                rt.funnel(ev(rows), "2026-03-01", window_days=bad)

    def test_empty_events(self):
        f = rt.funnel(ev([]), "2026-03-01")
        assert list(f["users"]) == [0, 0, 0] and list(f["from_prev"]) == [1.0, 0.0, 0.0]
