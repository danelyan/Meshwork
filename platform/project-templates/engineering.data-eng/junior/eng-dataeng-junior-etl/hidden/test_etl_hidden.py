# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import etl

HEADER = "order_id,customer_email,amount,currency,created_at\n"


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.db = os.path.join(self.dir, "out.db")

    def write(self, body, header=HEADER, name="in.csv", bom=False):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8-sig" if bom else "utf-8", newline="") as f:
            f.write(header + body)
        return path

    def rows(self, sql):
        con = sqlite3.connect(self.db)
        try:
            return con.execute(sql).fetchall()
        finally:
            con.close()


class Validation(Base):
    def test_reasons_and_lines(self):
        body = (
            " ,a@b.ru,1,RUB,2026-01-01\n"
            "B-1,a@b,1,RUB,2026-01-01\n"
            "B-2,a@b.ru,0,RUB,2026-01-01\n"
            "B-3,a@b.ru,1.234,RUB,2026-01-01\n"
            "B-4,a@b.ru,abc,RUB,2026-01-01\n"
            "B-5,a@b.ru,1,GBP,2026-01-01\n"
            "B-6,a@b.ru,1,RUB,2026-02-30\n"
            "B-7,a@b.ru,1,RUB,01.02.2026\n"
            "B-8,bad,-5,XXX,never\n"
        )
        rep = etl.run(self.write(body), self.db)
        self.assertEqual(rep, {"read": 9, "loaded": 0, "rejected": 9, "duplicates": 0})
        got = self.rows("select line, order_id, reason from rejected order by line")
        self.assertEqual(
            [(l, r) for l, _, r in got],
            [
                (2, "missing_order_id"),
                (3, "invalid_email"),
                (4, "invalid_amount"),
                (5, "invalid_amount"),
                (6, "invalid_amount"),
                (7, "invalid_currency"),
                (8, "invalid_date"),
                (9, "invalid_date"),
                (10, "invalid_email"),
            ],
        )
        self.assertEqual(got[1][1], "B-1")
        self.assertIn(got[0][1], ("", None))

    def test_normalization(self):
        body = (
            "  C-1 ,  Mixed.Case@Mail.RU ,\"1 234,5\",rub,2026-03-05\n"
            "C-2,x@y.io,\"15,50\", eur ,2026-03-06T23:59:59Z\n"
            "C-3,x@y.io,0.01,USD,2026-03-07T00:00:00\n"
        )
        rep = etl.run(self.write(body), self.db)
        self.assertEqual(rep["loaded"], 2)
        self.assertEqual(
            self.rows("select order_id, customer_email, amount_kop, currency, order_date from orders order by order_id"),
            [("C-2", "x@y.io", 1550, "EUR", "2026-03-06"), ("C-3", "x@y.io", 1, "USD", "2026-03-07")],
        )
        self.assertEqual(self.rows("select order_id, reason from rejected"), [("C-1", "invalid_amount")])

    def test_amount_precision(self):
        body = "D-1,a@b.ru,19.99,RUB,2026-01-01\nD-2,a@b.ru,0.1,RUB,2026-01-01\nD-3,a@b.ru,100,RUB,2026-01-01\n"
        etl.run(self.write(body), self.db)
        self.assertEqual(self.rows("select amount_kop from orders order by order_id"), [(1999,), (10,), (10000,)])


class Structure(Base):
    def test_bom_and_column_order_and_extra_columns(self):
        header = "currency,extra,created_at,amount,customer_email,order_id\n"
        rep = etl.run(self.write("RUB,zzz,2026-05-01,5,a@b.ru,E-1\n", header=header, bom=True), self.db)
        self.assertEqual(rep["loaded"], 1)
        self.assertEqual(self.rows("select order_id, amount_kop from orders"), [("E-1", 500)])

    def test_missing_column(self):
        path = self.write("F-1,a@b.ru,1,2026-01-01\n", header="order_id,customer_email,amount,created_at\n")
        with self.assertRaises(ValueError) as ctx:
            etl.run(path, self.db)
        self.assertIn("missing column: currency", str(ctx.exception))
        if os.path.exists(self.db):
            con = sqlite3.connect(self.db)
            names = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
            if "orders" in names:
                self.assertEqual(con.execute("select count(*) from orders").fetchone()[0], 0)
            con.close()

    def test_empty_file(self):
        rep = etl.run(self.write(""), self.db)
        self.assertEqual(rep, {"read": 0, "loaded": 0, "rejected": 0, "duplicates": 0})
        self.assertEqual(self.rows("select count(*) from orders"), [(0,)])


class Dedup(Base):
    def test_first_valid_wins(self):
        body = (
            "G-1,first@b.ru,1,RUB,2026-01-01\n"
            "G-1,second@b.ru,2,RUB,2026-01-02\n"
            "G-2,bad,1,RUB,2026-01-01\n"
            "G-2,ok@b.ru,3,RUB,2026-01-03\n"
            "G-1,third@b.ru,3,RUB,2026-01-03\n"
        )
        rep = etl.run(self.write(body), self.db)
        self.assertEqual(rep, {"read": 5, "loaded": 2, "rejected": 1, "duplicates": 2})
        self.assertEqual(
            self.rows("select order_id, customer_email from orders order by order_id"),
            [("G-1", "first@b.ru"), ("G-2", "ok@b.ru")],
        )


class Idempotency(Base):
    def test_rerun_same_file(self):
        path = self.write("H-1,a@b.ru,1,RUB,2026-01-01\nH-2,bad,1,RUB,2026-01-01\n")
        first = etl.run(path, self.db)
        second = etl.run(path, self.db)
        self.assertEqual(first, second)
        self.assertEqual(self.rows("select count(*) from orders"), [(1,)])
        self.assertEqual(self.rows("select count(*) from rejected"), [(1,)])

    def test_rerun_updates_and_keeps_old(self):
        etl.run(self.write("I-1,a@b.ru,1,RUB,2026-01-01\nI-2,b@b.ru,2,RUB,2026-01-01\n"), self.db)
        etl.run(self.write("I-1,new@b.ru,5,EUR,2026-02-02\nI-3,bad,1,RUB,2026-01-01\n", name="second.csv"), self.db)
        self.assertEqual(
            self.rows("select order_id, customer_email, amount_kop, currency from orders order by order_id"),
            [("I-1", "new@b.ru", 500, "EUR"), ("I-2", "b@b.ru", 200, "RUB")],
        )
        self.assertEqual(self.rows("select line, reason from rejected"), [(3, "invalid_email")])


class Cli(Base):
    def test_cli_prints_json(self):
        path = self.write("J-1,a@b.ru,1,RUB,2026-01-01\n")
        root = os.path.dirname(os.path.abspath(etl.__file__))
        out = subprocess.run([sys.executable, os.path.join(root, "etl.py"), path, self.db], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(json.loads(out.stdout.strip().splitlines()[-1]), {"read": 1, "loaded": 1, "rejected": 0, "duplicates": 0})
