# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import os
import sqlite3
import tempfile
import unittest

import etl

CSV = "order_id,customer_email,amount,currency,created_at\nA-1,Anna@Example.com,1990.00,RUB,2026-10-01\nA-2,bad,10,RUB,2026-10-02\n"


class EtlVisible(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.csv = os.path.join(self.dir, "in.csv")
        self.db = os.path.join(self.dir, "out.db")
        with open(self.csv, "w", encoding="utf-8") as f:
            f.write(CSV)

    def test_report(self):
        self.assertEqual(etl.run(self.csv, self.db), {"read": 2, "loaded": 1, "rejected": 1, "duplicates": 0})

    def test_loaded_row(self):
        etl.run(self.csv, self.db)
        con = sqlite3.connect(self.db)
        row = con.execute("select order_id, customer_email, amount_kop, currency, order_date from orders").fetchone()
        con.close()
        self.assertEqual(row, ("A-1", "anna@example.com", 199000, "RUB", "2026-10-01"))
