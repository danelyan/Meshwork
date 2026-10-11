# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import unittest

from resilience import Rejected, ResilientClient, TransientError


class Env:
    def __init__(self, script=None):
        self.t = 1000.0
        self.sleeps = []
        self.calls = []
        self.script = list(script or [])

    def now(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s

    def upstream(self, req):
        self.calls.append(req)
        outcome = self.script.pop(0) if self.script else "ok"
        if outcome == "fail":
            raise TransientError("boom")
        return "r:" + req

    def client(self, **cfg):
        return ResilientClient(self.upstream, self.now, self.sleep, **cfg)


class ResilienceVisible(unittest.TestCase):
    def test_retries_with_exponential_backoff(self):
        env = Env(["fail", "fail", "ok"])
        c = env.client(retry_min=5)
        self.assertEqual(c.call("x"), "r:x")
        self.assertEqual(env.sleeps, [0.1, 0.2])
        self.assertEqual(c.stats()["upstream_calls"], 3)
        self.assertEqual(c.stats()["retries"], 2)

    def test_breaker_opens_and_short_circuits(self):
        env = Env(["fail"] * 5)
        c = env.client(max_attempts=1)
        for _ in range(5):
            with self.assertRaises(TransientError):
                c.call("x")
        self.assertEqual(c.state(), "open")
        with self.assertRaises(Rejected) as cm:
            c.call("x")
        self.assertEqual(cm.exception.reason, "breaker_open")
        self.assertEqual(len(env.calls), 5)

    def test_half_open_probe_closes_breaker(self):
        env = Env(["fail"] * 5)
        c = env.client(max_attempts=1)
        for _ in range(5):
            with self.assertRaises(TransientError):
                c.call("x")
        env.t += 30
        self.assertEqual(c.state(), "half_open")
        c.call("x")
        self.assertEqual(c.state(), "half_open")
        c.call("x")
        self.assertEqual(c.state(), "closed")

    def test_low_priority_is_shed_first(self):
        env = Env()
        c = env.client(capacity=10)
        for _ in range(5):
            c.call("x", "low")
        with self.assertRaises(Rejected) as cm:
            c.call("x", "low")
        self.assertEqual(cm.exception.reason, "shed")
        c.call("x", "normal")
        c.call("x", "critical")
        self.assertEqual(c.stats()["shed"], 1)


if __name__ == "__main__":
    unittest.main()
