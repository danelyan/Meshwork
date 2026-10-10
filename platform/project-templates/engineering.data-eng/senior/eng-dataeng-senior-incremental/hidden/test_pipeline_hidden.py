# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import copy
import json
import os
import random
import re
import unittest
from datetime import timedelta

import pipeline


def ev(i, t, user="u-1", kind="purchase", amount=100):
    return {"event_id": f"e-{i}", "user_id": user, "kind": kind, "amount_kop": amount, "event_time": t}


def day(rep, date, user="u-1"):
    return next(d for d in rep["days"] if d["date"] == date and d["user_id"] == user)


class Aggregates(unittest.TestCase):
    def test_daily_sums_by_utc_day(self):
        s = pipeline.process_batch(None, [
            ev(1, "2026-10-01T10:00:00+00:00", amount=1000),
            ev(2, "2026-10-01T12:00:00+00:00", kind="refund", amount=300),
            ev(3, "2026-10-02T01:00:00+03:00", amount=50),  # 2026-10-01 22:00 UTC
            ev(4, "2026-10-01T11:00:00Z", user="u-2", amount=7),
        ])
        rep = pipeline.report(s)
        self.assertEqual(day(rep, "2026-10-01"), {"date": "2026-10-01", "user_id": "u-1", "purchases_kop": 1050, "refunds_kop": 300, "net_kop": 750, "events": 3})
        self.assertEqual([(d["date"], d["user_id"]) for d in rep["days"]], [("2026-10-01", "u-1"), ("2026-10-01", "u-2")])

    def test_report_sorted_and_initial(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-03T10:00:00Z", user="b"), ev(2, "2026-10-03T09:00:00Z", user="a"), ev(3, "2026-10-02T23:00:00Z", user="z")])
        rep = pipeline.report(s)
        self.assertEqual([(d["date"], d["user_id"]) for d in rep["days"]], [("2026-10-02", "z"), ("2026-10-03", "a"), ("2026-10-03", "b")])
        self.assertEqual(rep["watermark"], "2026-10-03T08:00:00+00:00")
        empty = pipeline.report(pipeline.process_batch(None, []))
        self.assertEqual(empty, {"days": [], "late": 0, "duplicates": 0, "rejected": {}, "watermark": None})


class Validation(unittest.TestCase):
    def test_reasons(self):
        good = ev(0, "2026-10-01T10:00:00Z")
        bad = [
            {k: v for k, v in good.items() if k != "user_id"} | {"event_id": "m1"},
            good | {"event_id": "m2", "kind": "gift", "amount_kop": -1, "event_time": None, "user_id": None},
            good | {"event_id": "", "user_id": "u"},
            good | {"event_id": "t1", "user_id": 5},
            good | {"event_id": "k1", "kind": "gift"},
            good | {"event_id": "a1", "amount_kop": -5},
            good | {"event_id": "a2", "amount_kop": True},
            good | {"event_id": "a3", "amount_kop": 10.0},
            good | {"event_id": "a4", "amount_kop": "100"},
            good | {"event_id": "d1", "event_time": "2026-10-01T10:00:00"},
            good | {"event_id": "d2", "event_time": "вчера"},
            good | {"event_id": "d3", "event_time": 1696150800},
        ]
        rep = pipeline.report(pipeline.process_batch(None, bad + [good]))
        self.assertEqual(rep["rejected"], {"missing_field": 1, "bad_type": 3, "bad_kind": 1, "bad_amount": 4, "bad_time": 3})
        self.assertEqual(len(rep["days"]), 1)
        self.assertEqual(rep["days"][0]["events"], 1)


class Dedup(unittest.TestCase):
    def test_duplicates_in_batch_and_across_batches(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-01T10:00:00Z"), ev(1, "2026-10-01T10:00:00Z")])
        s = pipeline.process_batch(s, [ev(1, "2026-10-01T10:00:00Z"), ev(2, "2026-10-01T10:05:00Z")])
        rep = pipeline.report(s)
        self.assertEqual(rep["duplicates"], 2)
        self.assertEqual(day(rep, "2026-10-01")["events"], 2)

    def test_reprocessing_same_batch_keeps_days_and_watermark(self):
        batch = [ev(i, f"2026-10-01T{10 + i % 5:02d}:00:00Z", user=f"u-{i % 3}") for i in range(20)]
        a = pipeline.process_batch(None, batch)
        b = pipeline.process_batch(a, batch)
        ra, rb = pipeline.report(a), pipeline.report(b)
        self.assertEqual(rb["days"], ra["days"])
        self.assertEqual(rb["watermark"], ra["watermark"])
        # события старше нового водяного знака теперь поздние, остальные — повторы
        self.assertEqual((rb["late"], rb["duplicates"]), (8, 12))


class Watermark(unittest.TestCase):
    def test_late_events(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-01T12:00:00Z")])
        s = pipeline.process_batch(s, [ev(2, "2026-10-01T09:59:59Z"), ev(3, "2026-10-01T10:00:00Z")])
        rep = pipeline.report(s)
        self.assertEqual(rep["late"], 1)
        self.assertEqual(day(rep, "2026-10-01")["events"], 2)

    def test_watermark_fixed_within_batch_and_order_independent(self):
        s0 = pipeline.process_batch(None, [ev(1, "2026-10-01T12:00:00Z")])
        batch = [ev(2, "2026-10-01T20:00:00Z"), ev(3, "2026-10-01T11:00:00Z"), ev(4, "2026-10-01T10:30:00Z"), ev(5, "2026-10-01T09:00:00Z")]
        a = pipeline.report(pipeline.process_batch(s0, batch))
        shuffled = batch[:]
        random.Random(7).shuffle(shuffled)
        b = pipeline.report(pipeline.process_batch(s0, shuffled))
        self.assertEqual(a, b)
        self.assertEqual(a["late"], 1)
        self.assertEqual(day(a, "2026-10-01")["events"], 4)
        self.assertEqual(a["watermark"], "2026-10-01T18:00:00+00:00")

    def test_custom_allowed_lateness(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-01T12:00:00Z")], allowed_lateness=timedelta(minutes=10))
        s = pipeline.process_batch(s, [ev(2, "2026-10-01T11:49:00Z"), ev(3, "2026-10-01T11:51:00Z")], allowed_lateness=timedelta(minutes=10))
        self.assertEqual(pipeline.report(s)["late"], 1)

    def test_late_wins_over_duplicate(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-01T10:00:00Z")])
        s = pipeline.process_batch(s, [ev(2, "2026-10-03T10:00:00Z")])
        s = pipeline.process_batch(s, [ev(1, "2026-10-01T10:00:00Z")])
        rep = pipeline.report(s)
        self.assertEqual((rep["late"], rep["duplicates"]), (1, 0))
        self.assertEqual(day(rep, "2026-10-01")["events"], 1)


class Memory(unittest.TestCase):
    def test_seen_ids_pruned_behind_watermark(self):
        batch = [ev(i, f"2026-10-01T10:{i % 60:02d}:00Z") for i in range(500)]
        s = pipeline.process_batch(None, batch)
        self.assertEqual(pipeline.seen_count(s), 500)
        s = pipeline.process_batch(s, [ev(10_000, "2026-10-05T10:00:00Z")])
        self.assertEqual(pipeline.seen_count(s), 1)
        s = pipeline.process_batch(s, batch[:10])
        rep = pipeline.report(s)
        self.assertEqual(rep["late"], 10)
        self.assertEqual(day(rep, "2026-10-01")["events"], 500)


class Purity(unittest.TestCase):
    def test_state_not_mutated_and_json_serializable(self):
        s1 = pipeline.process_batch(None, [ev(1, "2026-10-01T10:00:00Z")])
        frozen = copy.deepcopy(s1)
        s2 = pipeline.process_batch(s1, [ev(2, "2026-10-01T11:00:00Z"), ev(1, "2026-10-01T10:00:00Z"), {"bad": True}])
        self.assertEqual(s1, frozen)
        self.assertIsNot(s2, s1)
        restored = json.loads(json.dumps(s2))
        s3 = pipeline.process_batch(restored, [ev(3, "2026-10-01T12:00:00Z")])
        self.assertEqual(day(pipeline.report(s3), "2026-10-01")["events"], 3)


class Design(unittest.TestCase):
    def test_design_md_sections(self):
        path = os.path.join(os.path.dirname(os.path.abspath(pipeline.__file__)), "DESIGN.md")
        self.assertTrue(os.path.exists(path), "нет DESIGN.md в корне репозитория")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for h in ("Решения", "Компромиссы", "Границы применимости"):
            m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
            self.assertIsNotNone(m, h)
            self.assertGreaterEqual(len(m.group(1).strip()), 200, h)
