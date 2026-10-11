# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pandas as pd

import quality

CUSTOMERS = pd.DataFrame({"customer_id": ["c1", "c2"]})


def frame(rows):
    return pd.DataFrame(rows, columns=["order_id", "customer_id", "amount", "status", "created_at"])


def test_clean_is_normalized():
    orders = frame([[" A-1 ", "c1", "19.5", "Paid", "2026-10-01"]])
    clean, quarantine, report = quality.check(orders, CUSTOMERS)
    assert clean.to_dict("records") == [
        {"order_id": "A-1", "customer_id": "c1", "amount": 19.5, "status": "paid", "created_at": "2026-10-01"}
    ]
    assert len(quarantine) == 0
    assert report["clean"] == 1


def test_first_violated_rule_wins():
    orders = frame([["A-1", "zz", -1, "new", "2026-10-01"], ["A-2", "c1", 5, "new", "2026-10-02"]])
    clean, quarantine, report = quality.check(orders, CUSTOMERS)
    assert list(quarantine["reason"]) == ["bad_amount"]
    assert list(quarantine["row"]) == [0]
    assert report["total"] == 2 and report["quarantined"] == 1


def test_duplicate_keeps_first():
    orders = frame([["A-1", "c1", 5, "new", "2026-10-01"], ["A-1", "c2", 6, "new", "2026-10-02"]])
    clean, quarantine, _ = quality.check(orders, CUSTOMERS)
    assert list(clean["customer_id"]) == ["c1"]
    assert list(quarantine["reason"]) == ["duplicate_id"]
