# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import unittest

import slo


def ev(ts, status=200, latency=100):
    return {"ts": ts, "status": status, "latency_ms": latency}


class SloVisible(unittest.TestCase):
    def test_availability_ignores_4xx_and_counts_5xx(self):
        events = [ev(0), ev(1, 404), ev(2, 500), ev(3, 503)]
        self.assertEqual(slo.availability(events, 0, 10), 0.5)

    def test_availability_empty_is_none(self):
        self.assertIsNone(slo.availability([ev(50)], 0, 10))

    def test_percentile_nearest_rank(self):
        self.assertEqual(slo.percentile(list(range(1, 21)), 95), 19)
        self.assertIsNone(slo.percentile([], 99))

    def test_window_report_keeps_empty_window(self):
        rep = slo.window_report([ev(1), ev(2, 500)], 0, 20, 10)
        self.assertEqual(len(rep), 2)
        self.assertEqual((rep[0]["total"], rep[0]["good"], rep[0]["availability"]), (2, 1, 0.5))
        self.assertEqual((rep[1]["total"], rep[1]["availability"], rep[1]["p95"]), (0, None, None))

    def test_error_budget_boundary_is_not_exhausted(self):
        events = [ev(i) for i in range(999)] + [ev(999, 500)]
        b = slo.error_budget(events, 0, 1000, 0.999)
        self.assertEqual((b["total"], b["bad"]), (1000, 1))
        self.assertFalse(b["exhausted"])
        self.assertAlmostEqual(b["remaining"], 0.0)


if __name__ == "__main__":
    unittest.main()
