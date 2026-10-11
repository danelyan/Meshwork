"""Проверки качества данных с карантином по контракту (contract.md)."""
import json
import math
import os
import re
from datetime import datetime

import pandas as pd

REQUIRED = ["order_id", "customer_id", "amount", "status", "created_at"]
RULES = ["missing_required", "bad_amount", "bad_status", "bad_date", "unknown_customer", "duplicate_id"]
STATUSES = {"new", "paid", "shipped", "cancelled"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _missing(v) -> bool:
    if v is None:
        return True
    try:
        if pd.isna(v):
            return True
    except (TypeError, ValueError):
        pass
    return str(v).strip() == ""


def _text(v) -> str:
    return str(v).strip()


def _amount(v, max_amount):
    try:
        x = float(_text(v))
    except ValueError:
        return None
    if not math.isfinite(x) or x <= 0 or x > max_amount:
        return None
    return x


def _date_ok(s: str) -> bool:
    if not DATE_RE.match(s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def check(orders: pd.DataFrame, customers: pd.DataFrame, max_amount: float = 1_000_000):
    for col in REQUIRED:
        if col not in orders.columns:
            raise ValueError(f"missing column: {col}")
    if "customer_id" not in customers.columns:
        raise ValueError("missing column: customer_id")

    known = {_text(v) for v in customers["customer_id"] if not _missing(v)}
    seen = set()
    clean_rows, bad_rows = [], []
    by_rule = {r: 0 for r in RULES}
    columns = list(orders.columns)

    for pos, rec in enumerate(orders.to_dict("records")):
        reason = None
        if any(_missing(rec[c]) for c in REQUIRED):
            reason = "missing_required"
        elif _amount(rec["amount"], max_amount) is None:
            reason = "bad_amount"
        elif _text(rec["status"]).lower() not in STATUSES:
            reason = "bad_status"
        elif not _date_ok(_text(rec["created_at"])):
            reason = "bad_date"
        elif _text(rec["customer_id"]) not in known:
            reason = "unknown_customer"
        elif _text(rec["order_id"]) in seen:
            reason = "duplicate_id"
        if reason:
            by_rule[reason] += 1
            bad_rows.append({"row": pos, "reason": reason, **rec})
        else:
            seen.add(_text(rec["order_id"]))
            out = dict(rec)
            out["order_id"] = _text(rec["order_id"])
            out["customer_id"] = _text(rec["customer_id"])
            out["status"] = _text(rec["status"]).lower()
            out["created_at"] = _text(rec["created_at"])
            out["amount"] = _amount(rec["amount"], max_amount)
            clean_rows.append(out)

    clean = pd.DataFrame(clean_rows, columns=columns)
    clean["amount"] = clean["amount"].astype("float64")
    quarantine = pd.DataFrame(bad_rows, columns=["row", "reason"] + columns)
    report = {
        "total": len(orders),
        "clean": len(clean),
        "quarantined": len(quarantine),
        "by_rule": by_rule,
    }
    return clean, quarantine, report


def _read(path: str) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")


def run(orders_csv: str, customers_csv: str, out_dir: str) -> dict:
    clean, quarantine, report = check(_read(orders_csv), _read(customers_csv))
    os.makedirs(out_dir, exist_ok=True)
    clean.to_csv(os.path.join(out_dir, "clean.csv"), index=False)
    quarantine.to_csv(os.path.join(out_dir, "quarantine.csv"), index=False)
    with open(os.path.join(out_dir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False)
    return report
