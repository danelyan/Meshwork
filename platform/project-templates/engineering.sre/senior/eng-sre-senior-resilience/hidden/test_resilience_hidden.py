# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import os
import re
import unittest

import resilience
from resilience import Rejected, ResilientClient, TransientError


class Env:
    def __init__(self, script=None, default="ok"):
        self.t = 1000.0
        self.sleeps = []
        self.calls = []
        self.script = list(script or [])
        self.default = default

    def now(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s

    def upstream(self, req):
        self.calls.append(req)
        outcome = self.script.pop(0) if self.script else self.default
        if outcome == "fail":
            raise TransientError(f"fail-{len(self.calls)}")
        if outcome == "bad":
            raise ValueError("bad request")
        return "r:" + str(req)

    def client(self, **cfg):
        return ResilientClient(self.upstream, self.now, self.sleep, **cfg)


def reason(fn, *a):
    try:
        fn(*a)
    except Rejected as e:
        return e.reason
    return None


def fails(fn, *a):
    try:
        fn(*a)
    except TransientError:
        return True
    return False


class Validation(unittest.TestCase):
    def test_bad_config_raises(self):
        env = Env()
        for cfg in [{"failure_threshold": 0}, {"failure_window_s": 0}, {"cooldown_s": -1}, {"half_open_successes": 0},
                    {"max_attempts": 0}, {"backoff_s": 0}, {"max_backoff_s": 0}, {"budget_window_s": 0},
                    {"capacity": 0}, {"shed_window_s": 0}, {"retry_ratio": -0.1}, {"retry_min": -1}, {"nope": 1}]:
            with self.assertRaises(ValueError, msg=str(cfg)):
                env.client(**cfg)
        env.client(retry_ratio=0, retry_min=0)

    def test_unknown_priority_raises_and_is_not_counted(self):
        env = Env()
        c = env.client()
        with self.assertRaises(ValueError):
            c.call("x", "urgent")
        self.assertEqual(c.stats(), {"calls": 0, "shed": 0, "short_circuited": 0, "upstream_calls": 0, "retries": 0, "retries_denied": 0})
        self.assertEqual(env.calls, [])


class Retries(unittest.TestCase):
    def test_non_transient_error_is_final_and_not_retried(self):
        env = Env(["bad"])
        c = env.client()
        with self.assertRaises(ValueError):
            c.call("x")
        self.assertEqual(len(env.calls), 1)
        self.assertEqual(env.sleeps, [])
        self.assertEqual(c.stats()["retries"], 0)

    def test_backoff_doubles_and_is_capped(self):
        env = Env(["fail"] * 4 + ["ok"])
        c = env.client(max_attempts=5, backoff_s=0.5, max_backoff_s=1, retry_min=10)
        self.assertEqual(c.call("x"), "r:x")
        self.assertEqual(env.sleeps, [0.5, 1, 1, 1])

    def test_exhausted_attempts_raise_the_last_error(self):
        env = Env(default="fail")
        c = env.client(retry_min=10)
        with self.assertRaises(TransientError) as cm:
            c.call("x")
        self.assertEqual(str(cm.exception), "fail-3")
        self.assertEqual(len(env.calls), 3)
        self.assertEqual(c.stats()["retries"], 2)

    def test_retry_budget_is_a_share_of_accepted_calls(self):
        env = Env(default="fail")
        c = env.client(max_attempts=2, retry_ratio=0.2, retry_min=0, failure_threshold=1000)
        for _ in range(10):
            self.assertTrue(fails(c.call, "x"))
        s = c.stats()
        self.assertEqual((s["retries"], s["retries_denied"], s["upstream_calls"]), (2, 8, 12))
        self.assertEqual(len(env.sleeps), 2)

    def test_retry_budget_window_slides(self):
        env = Env(default="fail")
        c = env.client(max_attempts=2, retry_ratio=0, retry_min=1, failure_threshold=1000)
        self.assertTrue(fails(c.call, "x"))  # повтор в t=1000
        self.assertTrue(fails(c.call, "x"))
        self.assertEqual(c.stats()["retries"], 1)
        env.t = 1009.5
        self.assertTrue(fails(c.call, "x"))
        self.assertEqual(c.stats()["retries"], 1)
        env.t = 1010
        self.assertTrue(fails(c.call, "x"))
        self.assertEqual(c.stats()["retries"], 2)

    def test_retries_do_not_consume_admission_capacity(self):
        env = Env(["fail", "fail", "ok"])
        c = env.client(capacity=4, retry_min=5)
        for _ in range(4):
            c.call("x", "critical")
        self.assertEqual(reason(c.call, "x", "critical"), "shed")
        self.assertEqual(c.stats()["retries"], 2)


class Breaker(unittest.TestCase):
    def test_every_attempt_counts_and_open_breaker_stops_retries(self):
        env = Env(default="fail")
        c = env.client(failure_threshold=3, max_attempts=5, retry_min=10)
        self.assertEqual(reason(c.call, "x"), "breaker_open")
        s = c.stats()
        self.assertEqual((s["upstream_calls"], s["retries"], s["short_circuited"]), (3, 2, 1))
        self.assertEqual(env.sleeps, [0.1, 0.2])
        self.assertEqual(c.state(), "open")

    def test_failure_window_slides(self):
        env = Env(default="fail")
        c = env.client(failure_threshold=3, failure_window_s=10, max_attempts=1)
        for t in (1000, 1005, 1010):
            env.t = t
            self.assertTrue(fails(c.call, "x"))
        self.assertEqual(c.state(), "closed")  # ошибка t=1000 уже вышла из окна (1000, 1010]
        env.t = 1011
        self.assertTrue(fails(c.call, "x"))
        self.assertEqual(c.state(), "open")

    def test_successes_do_not_reset_the_failure_count(self):
        env = Env(["fail", "ok", "fail", "ok", "fail"])
        c = env.client(failure_threshold=3, max_attempts=1)
        for _ in range(5):
            try:
                c.call("x")
            except TransientError:
                pass
        self.assertEqual(c.state(), "open")

    def test_open_until_cooldown_then_half_open(self):
        env = Env(["fail"] * 5)
        c = env.client(max_attempts=1)
        for _ in range(5):
            fails(c.call, "x")
        env.t += 29.9
        self.assertEqual(c.state(), "open")
        self.assertEqual(reason(c.call, "x"), "breaker_open")
        self.assertEqual(c.stats()["short_circuited"], 1)
        env.t += 0.1
        self.assertEqual(c.state(), "half_open")
        self.assertEqual(c.call("x"), "r:x")
        self.assertEqual(len(env.calls), 6)

    def test_half_open_failure_reopens_and_resets_the_streak(self):
        env = Env(["fail"] * 5 + ["ok", "fail"])
        c = env.client(max_attempts=1)
        for _ in range(5):
            fails(c.call, "x")
        env.t += 30
        c.call("x")  # 1 успех из 2
        self.assertTrue(fails(c.call, "x"))  # ошибка в half_open -> open, opened_at = 1030
        self.assertEqual(c.state(), "open")
        env.t += 29.9
        self.assertEqual(reason(c.call, "x"), "breaker_open")
        env.t += 0.1
        c.call("x")
        self.assertEqual(c.state(), "half_open")  # серия успехов началась заново
        c.call("x")
        self.assertEqual(c.state(), "closed")

    def test_non_transient_error_counts_as_success_in_half_open(self):
        env = Env(["fail"] * 5 + ["bad"])
        c = env.client(max_attempts=1, half_open_successes=2)
        for _ in range(5):
            fails(c.call, "x")
        env.t += 30
        with self.assertRaises(ValueError):
            c.call("x")
        c.call("x")
        self.assertEqual(c.state(), "closed")

    def test_closed_after_recovery_forgets_old_failures(self):
        env = Env(["fail"] * 5)
        c = env.client(max_attempts=1, half_open_successes=1)
        for _ in range(5):
            fails(c.call, "x")
        env.t += 30
        c.call("x")
        self.assertEqual(c.state(), "closed")
        env.script = ["fail"] * 4
        for _ in range(4):
            fails(c.call, "x")
        self.assertEqual(c.state(), "closed")  # 4 < 5: прежние ошибки не вернулись
        env.script = ["fail"]
        fails(c.call, "x")
        self.assertEqual(c.state(), "open")


class Shedding(unittest.TestCase):
    def test_breaker_is_checked_before_shedding(self):
        env = Env(["fail"] * 5)
        c = env.client(max_attempts=1, capacity=5)
        for _ in range(5):
            self.assertTrue(fails(c.call, "x", "critical"))
        self.assertEqual(c.state(), "open")  # окно приёма заполнено (5 из 5), но breaker проверяется первым
        self.assertEqual(reason(c.call, "x", "critical"), "breaker_open")
        s = c.stats()
        self.assertEqual((s["short_circuited"], s["shed"]), (1, 0))

    def test_priority_limits_and_rejected_calls_are_not_counted(self):
        env = Env()
        c = env.client(capacity=10)
        for _ in range(5):
            c.call("x", "low")
        self.assertEqual(reason(c.call, "x", "low"), "shed")
        for _ in range(3):
            c.call("x", "normal")
        self.assertEqual(reason(c.call, "x", "normal"), "shed")
        self.assertEqual(reason(c.call, "x", "low"), "shed")
        for _ in range(2):
            c.call("x", "critical")
        self.assertEqual(reason(c.call, "x", "critical"), "shed")
        self.assertEqual(len(env.calls), 10)
        s = c.stats()
        self.assertEqual((s["calls"], s["shed"]), (14, 4))

    def test_admission_window_slides(self):
        env = Env()
        c = env.client(capacity=2, shed_window_s=1)
        c.call("x", "critical")
        env.t += 0.5
        c.call("x", "critical")
        self.assertEqual(reason(c.call, "x", "critical"), "shed")
        env.t = 1001  # первый вызов (t=1000) вышел из окна (1000, 1001]
        c.call("x", "critical")
        self.assertEqual(reason(c.call, "x", "critical"), "shed")



class Scenario(unittest.TestCase):
    def test_total_outage_is_bounded_by_the_breaker(self):
        env = Env(default="fail")
        c = env.client()
        for _ in range(100):
            try:
                c.call("x")
            except (TransientError, Rejected):
                pass
            env.t += 1
        s = c.stats()
        self.assertEqual(s["calls"], 100)
        self.assertLess(s["upstream_calls"], 20)
        self.assertGreater(s["short_circuited"], 70)



class Design(unittest.TestCase):
    def test_design_md_sections(self):
        path = os.path.join(os.path.dirname(os.path.abspath(resilience.__file__)), "DESIGN.md")
        self.assertTrue(os.path.exists(path), "нет DESIGN.md в корне репозитория")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for h in ("Решения", "Компромиссы", "Границы применимости"):
            m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
            self.assertIsNotNone(m, h)
            self.assertGreaterEqual(len(m.group(1).strip()), 200, h)


if __name__ == "__main__":
    unittest.main()
