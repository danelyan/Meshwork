# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import math
import unittest

import slo


def ev(ts, status=200, latency=100):
    return {"ts": ts, "status": status, "latency_ms": latency}


class IsGood(unittest.TestCase):
    def test_status_classes(self):
        self.assertTrue(slo.is_good(ev(0, 200)))
        self.assertTrue(slo.is_good(ev(0, 499)))
        self.assertFalse(slo.is_good(ev(0, 500)))
        self.assertFalse(slo.is_good(ev(0, 599)))


class Availability(unittest.TestCase):
    def test_range_is_half_open(self):
        events = [ev(10, 500), ev(19), ev(20, 500)]
        self.assertEqual(slo.availability(events, 10, 20), 0.5)
        self.assertEqual(slo.availability(events, 20, 30), 0.0)

    def test_unsorted_input_and_input_not_mutated(self):
        events = [ev(5), ev(1, 500), ev(3)]
        snapshot = [dict(e) for e in events]
        self.assertAlmostEqual(slo.availability(events, 0, 10), 2 / 3)
        self.assertEqual(events, snapshot)

    def test_all_good_is_one(self):
        self.assertEqual(slo.availability([ev(1), ev(2)], 0, 5), 1.0)

    def test_invalid_range_and_events(self):
        with self.assertRaises(ValueError):
            slo.availability([ev(1)], 5, 5)
        with self.assertRaises(ValueError):
            slo.availability([ev(1)], 6, 5)
        with self.assertRaises(ValueError):
            slo.availability([{"ts": 1, "status": 200}], 0, 5)
        with self.assertRaises(ValueError):
            slo.availability([ev(1, latency=-1)], 0, 5)
        with self.assertRaises(ValueError):
            slo.availability([ev(1, latency="12")], 0, 5)
        with self.assertRaises(ValueError):
            slo.availability([ev(1.5)], 0, 5)

    def test_invalid_event_outside_range_still_rejected(self):
        with self.assertRaises(ValueError):
            slo.availability([ev(1), {"ts": 100, "status": 200}], 0, 5)


class LatencySli(unittest.TestCase):
    def test_threshold_is_inclusive_and_counts_all_statuses(self):
        events = [ev(1, 200, 100), ev(2, 500, 100), ev(3, 200, 101), ev(4, 200, 20.5)]
        self.assertEqual(slo.latency_sli(events, 0, 10, 100), 0.75)

    def test_empty_and_bad_threshold(self):
        self.assertIsNone(slo.latency_sli([], 0, 10, 100))
        with self.assertRaises(ValueError):
            slo.latency_sli([ev(1)], 0, 10, 0)


class Percentile(unittest.TestCase):
    def test_nearest_rank_values(self):
        vals = [15, 20, 35, 40, 50]
        self.assertEqual(slo.percentile(vals, 30), 20)
        self.assertEqual(slo.percentile(vals, 40), 20)
        self.assertEqual(slo.percentile(vals, 50), 35)
        self.assertEqual(slo.percentile(vals, 100), 50)
        self.assertEqual(slo.percentile(vals, 0.5), 15)

    def test_unsorted_not_mutated_and_single(self):
        vals = [9, 1, 5]
        self.assertEqual(slo.percentile(vals, 99), 9)
        self.assertEqual(vals, [9, 1, 5])
        self.assertEqual(slo.percentile([7], 50), 7)

    def test_p_out_of_range(self):
        for p in (0, -1, 100.1):
            with self.assertRaises(ValueError):
                slo.percentile([1, 2], p)


class WindowReport(unittest.TestCase):
    def test_fields_and_order(self):
        events = [ev(0, 200, 10), ev(5, 500, 300)] + [ev(1 + i, 200, i + 1) for i in range(18)]
        rep = slo.window_report(events, 0, 40, 20)
        self.assertEqual([(w["start"], w["end"]) for w in rep], [(0, 20), (20, 40)])
        w0, w1 = rep
        self.assertEqual((w0["total"], w0["good"], w0["availability"]), (20, 19, 19 / 20))
        self.assertEqual(w0["p95"], 18)
        self.assertEqual(w0["p99"], 300)
        self.assertEqual((w1["total"], w1["good"], w1["availability"], w1["p95"], w1["p99"]), (0, 0, None, None, None))

    def test_events_on_window_boundary_go_to_next(self):
        rep = slo.window_report([ev(10, 500)], 0, 20, 10)
        self.assertEqual([w["total"] for w in rep], [0, 1])
        self.assertEqual(rep[1]["availability"], 0.0)

    def test_events_outside_range_ignored(self):
        rep = slo.window_report([ev(-1), ev(20)], 0, 20, 10)
        self.assertEqual([w["total"] for w in rep], [0, 0])

    def test_bad_window(self):
        for w in (0, -5, 7):
            with self.assertRaises(ValueError):
                slo.window_report([], 0, 20, w)


class ErrorBudget(unittest.TestCase):
    def test_remaining_and_ratio(self):
        events = [ev(i) for i in range(996)] + [ev(996 + i, 500) for i in range(4)]
        b = slo.error_budget(events, 0, 2000, 0.99)
        self.assertEqual((b["total"], b["bad"]), (1000, 4))
        self.assertAlmostEqual(b["allowed_bad"], 10.0)
        self.assertAlmostEqual(b["remaining"], 6.0)
        self.assertAlmostEqual(b["consumed_ratio"], 0.4)
        self.assertFalse(b["exhausted"])

    def test_exhausted_and_negative_remaining(self):
        events = [ev(i) for i in range(98)] + [ev(98 + i, 500) for i in range(2)]
        b = slo.error_budget(events, 0, 100, 0.99)
        self.assertAlmostEqual(b["allowed_bad"], 1.0)
        self.assertAlmostEqual(b["remaining"], -1.0)
        self.assertAlmostEqual(b["consumed_ratio"], 2.0)
        self.assertTrue(b["exhausted"])

    def test_floating_point_noise_does_not_leak(self):
        events = [ev(i) for i in range(999)] + [ev(999, 500)]
        b = slo.error_budget(events, 0, 1000, 0.999)
        self.assertEqual(b["allowed_bad"], 1.0)
        self.assertEqual(b["remaining"], 0.0)
        self.assertEqual(b["consumed_ratio"], 1.0)
        self.assertFalse(b["exhausted"])

    def test_no_events(self):
        b = slo.error_budget([], 0, 100, 0.999)
        self.assertEqual((b["total"], b["bad"]), (0, 0))
        self.assertIsNone(b["consumed_ratio"])
        self.assertFalse(b["exhausted"])
        self.assertEqual(b["allowed_bad"], 0)

    def test_4xx_do_not_consume_budget(self):
        b = slo.error_budget([ev(1, 404), ev(2, 429), ev(3)], 0, 10, 0.9)
        self.assertEqual(b["bad"], 0)
        self.assertEqual(b["consumed_ratio"], 0.0)

    def test_invalid_target(self):
        for t in (0, 1, 1.5, -0.1):
            with self.assertRaises(ValueError):
                slo.error_budget([ev(1)], 0, 10, t)


if __name__ == "__main__":
    unittest.main()
