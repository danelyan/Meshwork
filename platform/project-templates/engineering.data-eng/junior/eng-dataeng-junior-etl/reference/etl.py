"""Эталонное решение (кандидату не выдаётся): ETL заказов CSV -> SQLite."""
import csv
import json
import re
import sqlite3
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

REQUIRED = ["order_id", "customer_email", "amount", "currency", "created_at"]
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AMOUNT = re.compile(r"^\d+([.,]\d{1,2})?$")
DATE = re.compile(r"^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}Z?)?$")
CURRENCIES = {"RUB", "USD", "EUR"}

SCHEMA = """
create table if not exists orders(order_id text primary key, customer_email text not null,
  amount_kop integer not null, currency text not null, order_date text not null);
create table if not exists rejected(line integer not null, order_id text, reason text not null);
"""


def parse_row(row):
    order_id = (row["order_id"] or "").strip()
    if not order_id:
        return None, "missing_order_id"
    email = (row["customer_email"] or "").strip().lower()
    if not EMAIL.match(email):
        return None, "invalid_email"
    raw = (row["amount"] or "").strip()
    if not AMOUNT.match(raw):
        return None, "invalid_amount"
    try:
        amount = Decimal(raw.replace(",", "."))
    except InvalidOperation:
        return None, "invalid_amount"
    if amount <= 0:
        return None, "invalid_amount"
    currency = (row["currency"] or "").strip().upper()
    if currency not in CURRENCIES:
        return None, "invalid_currency"
    m = DATE.match((row["created_at"] or "").strip())
    if not m:
        return None, "invalid_date"
    try:
        day = date.fromisoformat(m.group(1))
        if m.group(2):
            datetime.fromisoformat(m.group(0).rstrip("Z"))
    except ValueError:
        return None, "invalid_date"
    return (order_id, email, int(amount * 100), currency, day.isoformat()), None


def run(csv_path: str, db_path: str) -> dict:
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        for col in REQUIRED:
            if fields and col not in fields:
                raise ValueError(f"missing column: {col}")
        rows = list(reader)
    report = {"read": len(rows), "loaded": 0, "rejected": 0, "duplicates": 0}
    seen = {}
    rejected = []
    for i, row in enumerate(rows):
        line = i + 2
        parsed, reason = parse_row(row)
        if reason:
            rejected.append((line, (row.get("order_id") or "").strip(), reason))
        elif parsed[0] in seen:
            report["duplicates"] += 1
        else:
            seen[parsed[0]] = parsed
    report["loaded"] = len(seen)
    report["rejected"] = len(rejected)
    con = sqlite3.connect(db_path)
    try:
        with con:
            con.executescript(SCHEMA)
            con.execute("delete from rejected")
            con.executemany(
                "insert into orders values(?,?,?,?,?) on conflict(order_id) do update set "
                "customer_email=excluded.customer_email, amount_kop=excluded.amount_kop, "
                "currency=excluded.currency, order_date=excluded.order_date",
                list(seen.values()),
            )
            con.executemany("insert into rejected values(?,?,?)", rejected)
    finally:
        con.close()
    return report


if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1], sys.argv[2]), ensure_ascii=False))
