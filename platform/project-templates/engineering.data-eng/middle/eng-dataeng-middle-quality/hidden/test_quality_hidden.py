# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import json
import os

import numpy as np
import pandas as pd
import pytest

import quality

COLS = ["order_id", "customer_id", "amount", "status", "created_at"]
RULES = ["missing_required", "bad_amount", "bad_status", "bad_date", "unknown_customer", "duplicate_id"]
CUSTOMERS = pd.DataFrame({"customer_id": ["c1", " c2 ", "", None], "name": list("abcd")})


def frame(rows, columns=COLS):
    return pd.DataFrame(rows, columns=columns)


def reasons(orders, **kw):
    _, q, _ = quality.check(orders, CUSTOMERS, **kw)
    return list(q["reason"])


def test_each_rule_code():
    orders = frame(
        [
            [None, "c1", 1, "new", "2026-01-01"],
            ["B-1", "c1", "abc", "new", "2026-01-01"],
            ["B-2", "c1", 1, "lost", "2026-01-01"],
            ["B-3", "c1", 1, "new", "2026-02-30"],
            ["B-4", "c7", 1, "new", "2026-01-01"],
            ["B-5", "c1", 1, "new", "2026-01-01"],
            ["B-5", "c1", 1, "new", "2026-01-02"],
        ]
    )
    clean, q, rep = quality.check(orders, CUSTOMERS)
    assert list(q["reason"]) == RULES
    assert list(q["row"]) == [0, 1, 2, 3, 4, 6]
    assert list(clean["order_id"]) == ["B-5"]
    assert rep == {"total": 7, "clean": 1, "quarantined": 6, "by_rule": {r: 1 for r in RULES}}
    assert list(rep["by_rule"]) == RULES


def test_blank_and_nan_are_missing():
    orders = frame(
        [
            ["A", "c1", np.nan, "new", "2026-01-01"],
            ["B", "  ", 1, "new", "2026-01-01"],
            ["C", "c1", 1, None, "2026-01-01"],
            ["D", "c1", 1, "new", ""],
        ]
    )
    assert reasons(orders) == ["missing_required"] * 4


@pytest.mark.parametrize(
    "amount,ok",
    [("0", False), (0, False), ("-1", False), ("0.01", True), (" 12.5 ", True), (1000000, True), (1000000.01, False),
     ("nan", False), ("inf", False), ("1,5", False), (7, True)],
)
def test_amount_rules(amount, ok):
    orders = frame([["A", "c1", amount, "new", "2026-01-01"]])
    clean, q, _ = quality.check(orders, CUSTOMERS)
    assert (len(clean) == 1) == ok
    if not ok:
        assert list(q["reason"]) == ["bad_amount"]


def test_max_amount_parameter():
    orders = frame([["A", "c1", 150, "new", "2026-01-01"], ["B", "c1", 100, "new", "2026-01-01"]])
    clean, q, _ = quality.check(orders, CUSTOMERS, max_amount=100)
    assert list(clean["order_id"]) == ["B"]
    assert list(q["reason"]) == ["bad_amount"]


@pytest.mark.parametrize(
    "date,ok",
    [("2026-02-28", True), ("2024-02-29", True), ("2026-02-29", False), ("2026-1-5", False), ("01.02.2026", False),
     ("2026-10-01T10:00:00", False), (" 2026-10-01 ", True)],
)
def test_date_rules(date, ok):
    orders = frame([["A", "c1", 1, "new", date]])
    assert (reasons(orders) == []) == ok


def test_normalization_and_extra_columns():
    orders = frame(
        [[" A ", " c2", "10", " SHIPPED ", " 2026-03-04 ", "note", 5]],
        columns=["order_id", "customer_id", "amount", "status", "created_at", "memo", "n"],
    )
    clean, _, _ = quality.check(orders, CUSTOMERS)
    assert list(clean.columns) == list(orders.columns)
    assert clean.to_dict("records") == [
        {"order_id": "A", "customer_id": "c2", "amount": 10.0, "status": "shipped", "created_at": "2026-03-04",
         "memo": "note", "n": 5}
    ]
    assert clean["amount"].dtype == "float64"


def test_quarantine_keeps_original_values_and_columns():
    orders = frame([[" A ", "c1", "-3", " New ", "2026-01-01"]], columns=["order_id", "customer_id", "amount", "status", "created_at"])
    orders["extra"] = ["x"]
    _, q, _ = quality.check(orders, CUSTOMERS)
    assert list(q.columns) == ["row", "reason"] + list(orders.columns)
    assert q.iloc[0].to_dict() == {"row": 0, "reason": "bad_amount", "order_id": " A ", "customer_id": "c1",
                                   "amount": "-3", "status": " New ", "created_at": "2026-01-01", "extra": "x"}


def test_duplicate_only_counts_valid_earlier_rows():
    orders = frame(
        [
            ["A", "c1", -1, "new", "2026-01-01"],  # плохая строка не занимает order_id
            ["A", "c1", 1, "new", "2026-01-02"],
            [" A", "c2", 2, "new", "2026-01-03"],  # дубль после обрезки
            ["A", "c9", 3, "new", "2026-01-04"],  # unknown_customer раньше duplicate_id
        ]
    )
    clean, q, rep = quality.check(orders, CUSTOMERS)
    assert list(clean["created_at"]) == ["2026-01-02"]
    assert list(q["reason"]) == ["bad_amount", "duplicate_id", "unknown_customer"]
    assert list(q["row"]) == [0, 2, 3]
    assert rep["by_rule"]["duplicate_id"] == 1


def test_positions_independent_of_index_and_order_kept():
    orders = frame([["A", "c1", 1, "new", "2026-01-01"], ["B", "zz", 1, "new", "2026-01-01"], ["C", "c1", 1, "new", "2026-01-01"]])
    orders.index = [40, 7, 7]
    clean, q, _ = quality.check(orders, CUSTOMERS)
    assert list(clean["order_id"]) == ["A", "C"] and list(clean.index) == [0, 1]
    assert list(q["row"]) == [1] and list(q.index) == [0]


def test_inputs_not_mutated():
    orders = frame([[" A ", "c1", "5", " NEW", "2026-01-01"], ["B", "c1", "x", "new", "2026-01-01"]])
    cust = CUSTOMERS.copy()
    o_before, c_before = orders.copy(deep=True), cust.copy(deep=True)
    quality.check(orders, cust)
    pd.testing.assert_frame_equal(orders, o_before)
    pd.testing.assert_frame_equal(cust, c_before)


def test_empty_orders():
    clean, q, rep = quality.check(frame([]), CUSTOMERS)
    assert list(clean.columns) == COLS and len(clean) == 0
    assert list(q.columns) == ["row", "reason"] + COLS and len(q) == 0
    assert rep == {"total": 0, "clean": 0, "quarantined": 0, "by_rule": {r: 0 for r in RULES}}


def test_missing_columns():
    with pytest.raises(ValueError, match="missing column: status"):
        quality.check(frame([["A", "c1", 1, "2026-01-01"]], columns=["order_id", "customer_id", "amount", "created_at"]), CUSTOMERS)
    with pytest.raises(ValueError, match="missing column: customer_id"):
        quality.check(frame([]), pd.DataFrame({"id": ["c1"]}))
    both = frame([], columns=["order_id"])
    with pytest.raises(ValueError, match="missing column: customer_id"):
        quality.check(both, pd.DataFrame({"id": []}))


def write(path, text, bom=False):
    with open(path, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
        f.write(text)


ORDERS_CSV = (
    "order_id,customer_id,amount,status,created_at,memo\n"
    "A-1,c1,10.50,PAID,2026-10-01,first\n"
    "A-2,c9,5,new,2026-10-02,\n"
    "A-1,c1,7,new,2026-10-03,dup\n"
    ",c1,7,new,2026-10-03,blank\n"
)


def test_run_writes_files_and_is_idempotent(tmp_path):
    write(tmp_path / "o.csv", ORDERS_CSV, bom=True)
    write(tmp_path / "c.csv", "customer_id,name\nc1,Anna\n", bom=True)
    out = tmp_path / "deep" / "out"
    rep = quality.run(str(tmp_path / "o.csv"), str(tmp_path / "c.csv"), str(out))
    assert rep["total"] == 4 and rep["clean"] == 1 and rep["quarantined"] == 3
    assert json.loads((out / "report.json").read_text(encoding="utf-8")) == rep
    clean = pd.read_csv(out / "clean.csv", dtype={"order_id": str}, keep_default_na=False)
    assert clean.to_dict("records") == [
        {"order_id": "A-1", "customer_id": "c1", "amount": 10.5, "status": "paid", "created_at": "2026-10-01", "memo": "first"}
    ]
    quar = pd.read_csv(out / "quarantine.csv", dtype=str, keep_default_na=False)
    assert list(quar.columns) == ["row", "reason", "order_id", "customer_id", "amount", "status", "created_at", "memo"]
    assert list(quar["reason"]) == ["unknown_customer", "duplicate_id", "missing_required"]
    assert list(quar["row"]) == ["1", "2", "3"]
    snapshot = {n: (out / n).read_bytes() for n in os.listdir(out)}
    assert set(snapshot) == {"clean.csv", "quarantine.csv", "report.json"}
    assert quality.run(str(tmp_path / "o.csv"), str(tmp_path / "c.csv"), str(out)) == rep
    assert {n: (out / n).read_bytes() for n in os.listdir(out)} == snapshot


def test_run_rerun_overwrites_old_results(tmp_path):
    write(tmp_path / "c.csv", "customer_id\nc1\n")
    out = tmp_path / "out"
    write(tmp_path / "o.csv", ORDERS_CSV)
    quality.run(str(tmp_path / "o.csv"), str(tmp_path / "c.csv"), str(out))
    write(tmp_path / "o.csv", "order_id,customer_id,amount,status,created_at\nZ,c1,1,new,2026-01-01\n")
    rep = quality.run(str(tmp_path / "o.csv"), str(tmp_path / "c.csv"), str(out))
    assert rep["quarantined"] == 0
    assert len(pd.read_csv(out / "quarantine.csv")) == 0
    assert list(pd.read_csv(out / "clean.csv")["order_id"]) == ["Z"]


def test_run_bad_input_leaves_out_dir_untouched(tmp_path):
    write(tmp_path / "c.csv", "customer_id\nc1\n")
    write(tmp_path / "o.csv", "order_id,customer_id\nA,c1\n")
    out = tmp_path / "out"
    with pytest.raises(ValueError, match="missing column: amount"):
        quality.run(str(tmp_path / "o.csv"), str(tmp_path / "c.csv"), str(out))
    assert not out.exists()
    out.mkdir()
    write(out / "report.json", "{}")
    with pytest.raises(ValueError):
        quality.run(str(tmp_path / "o.csv"), str(tmp_path / "c.csv"), str(out))
    assert os.listdir(out) == ["report.json"]
