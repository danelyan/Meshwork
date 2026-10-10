# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import unittest

import pipeline


def ev(i, t, kind="purchase", amount=100):
    return {"event_id": f"e-{i}", "user_id": "u-1", "kind": kind, "amount_kop": amount, "event_time": t}


class PipelineVisible(unittest.TestCase):
    def test_daily_aggregate(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-01T10:00:00Z", amount=500), ev(2, "2026-10-01T11:00:00Z", kind="refund", amount=200)])
        self.assertEqual(pipeline.report(s)["days"], [{"date": "2026-10-01", "user_id": "u-1", "purchases_kop": 500, "refunds_kop": 200, "net_kop": 300, "events": 2}])

    def test_duplicate_not_counted(self):
        s = pipeline.process_batch(None, [ev(1, "2026-10-01T10:00:00Z")])
        s = pipeline.process_batch(s, [ev(1, "2026-10-01T10:00:00Z")])
        rep = pipeline.report(s)
        self.assertEqual(rep["duplicates"], 1)
        self.assertEqual(rep["days"][0]["events"], 1)
