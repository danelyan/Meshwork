# PLATFORM-OWNED: скрытые тесты платформы
import os
import re
import unittest

import rollout


class Crash(BaseException):
    pass


class FakeClock:
    def __init__(self):
        self.t = 0
        self.sleeps = []

    def now(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


class FakeFleet:
    def __init__(self, versions, unhealthy=(), fail_deploy=(), fail_version=(), crash_on=None, raise_health=()):
        self.v = dict(versions)
        self.unhealthy = set(unhealthy)       # (host, version) -> нездоров
        self.fail_deploy = set(fail_deploy)   # (host, version) -> deploy бросает
        self.crash_on = crash_on              # (host, version) -> BaseException
        self.raise_health = set(raise_health)
        self.calls = []
        self.health_calls = []

    def version(self, host):
        return self.v.get(host)

    def deploy(self, host, version):
        self.calls.append(("deploy", host, version))
        if self.crash_on == (host, version):
            raise Crash()
        if (host, version) in self.fail_deploy:
            raise RuntimeError("boom")
        self.v[host] = version

    def remove(self, host):
        self.calls.append(("remove", host))
        self.v.pop(host, None)

    def healthy(self, host):
        self.health_calls.append(host)
        if host in self.raise_health:
            raise RuntimeError("probe")
        return (host, self.v.get(host)) not in self.unhealthy


H = ["a", "b", "c", "d", "e", "f", "g"]
OLD = {h: "1" for h in H}


def run(fleet, hosts=H, clock=None, **kw):
    return rollout.rollout(hosts, "2", fleet, clock or FakeClock(), **kw)


class Validation(unittest.TestCase):
    def code(self, *a, **kw):
        with self.assertRaises(rollout.RolloutError) as cm:
            rollout.rollout(*a, **kw)
        return cm.exception.code

    def test_hosts(self):
        f, c = FakeFleet({}), FakeClock()
        for bad in ([], ["a", "a"], ["a", ""], ["a", 1], "a", None):
            self.assertEqual(self.code(bad, "2", f, c), "invalid_hosts")
        self.assertEqual(f.calls, [])
        self.assertEqual(c.sleeps, [])

    def test_target_batches_health(self):
        f, c = FakeFleet({}), FakeClock()
        self.assertEqual(self.code(["a"], "", f, c), "invalid_target")
        self.assertEqual(self.code(["a"], 2, f, c), "invalid_target")
        for bad in ([], [0], [True], [1, -1], [1.5]):
            self.assertEqual(self.code(["a"], "2", f, c, batch_sizes=bad), "invalid_batches")
        for bad in ({"checks": 0}, {"interval": 0}, {"interval": 10, "timeout": 5}, {"checks": True}, {"foo": 1}):
            self.assertEqual(self.code(["a"], "2", f, c, health=bad), "invalid_health")
        self.assertEqual(f.calls, [])

    def test_plan_batches_validation(self):
        with self.assertRaises(rollout.RolloutError) as cm:
            rollout.plan_batches([], [1])
        self.assertEqual(cm.exception.code, "invalid_hosts")
        with self.assertRaises(rollout.RolloutError) as cm:
            rollout.plan_batches(["a"], [])
        self.assertEqual(cm.exception.code, "invalid_batches")

    def test_plan_batches_sizes(self):
        self.assertEqual([len(b) for b in rollout.plan_batches(H, [1, 2, 4])], [1, 2, 4])
        self.assertEqual([len(b) for b in rollout.plan_batches(H, [3])], [3, 3, 1])
        self.assertEqual(rollout.plan_batches(["a"], [5]), [["a"]])


class Happy(unittest.TestCase):
    def test_order_and_batches(self):
        f = FakeFleet(OLD)
        res = run(f, batch_sizes=[1, 2, 4])
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["batches"], [["a"], ["b", "c"], ["d", "e", "f", "g"]])
        self.assertEqual(res["deployed"], H)
        self.assertEqual([c[1] for c in f.calls], H)
        self.assertEqual((res["failed_batch"], res["failed_host"], res["reason"]), (None, None, None))
        self.assertEqual((res["rolled_back"], res["stuck"]), ([], []))

    def test_health_timing_defaults(self):
        c = FakeClock()
        res = run(FakeFleet(OLD), hosts=["a", "b"], clock=c, batch_sizes=[1])
        # два батча по checks=2 раунда по interval=5
        self.assertEqual(c.sleeps, [5, 5, 5, 5])
        self.assertEqual(res["elapsed"], 20)

    def test_health_custom_and_no_short_circuit(self):
        f = FakeFleet(OLD)
        c = FakeClock()
        run(f, hosts=["a", "b", "c"], clock=c, batch_sizes=[3], health={"checks": 3, "interval": 2})
        self.assertEqual(c.sleeps, [2, 2, 2])
        self.assertEqual(f.health_calls, ["a", "b", "c"] * 3)

    def test_streak_resets_on_flap(self):
        class Flap(FakeFleet):
            n = 0

            def healthy(self, host):
                Flap.n += 1
                return Flap.n != 2  # второй опрос нездоров -> счётчик сброшен
        c = FakeClock()
        res = run(Flap(OLD), hosts=["a"], clock=c, health={"checks": 2, "interval": 1, "timeout": 10})
        self.assertEqual(res["status"], "ok")
        self.assertEqual(c.sleeps, [1, 1, 1, 1])

    def test_new_host_without_version(self):
        f = FakeFleet({"a": "1"})
        res = run(f, hosts=["a", "b"], batch_sizes=[1])
        self.assertEqual(res["status"], "ok")
        self.assertEqual(f.v, {"a": "2", "b": "2"})


class Failures(unittest.TestCase):
    def test_deploy_error_stops_batch_and_rolls_back(self):
        f = FakeFleet(OLD, fail_deploy=[("c", "2")])
        res = run(f, hosts=["a", "b", "c", "d", "e"], batch_sizes=[2, 3])
        self.assertEqual(res["status"], "rolled_back")
        self.assertEqual((res["failed_batch"], res["failed_host"], res["reason"]), (1, "c", "deploy_error"))
        self.assertEqual(res["deployed"], ["a", "b"])
        self.assertEqual(res["rolled_back"], ["b", "a"])
        self.assertEqual(set(f.v.values()), {"1"})
        self.assertNotIn(("deploy", "d", "2"), f.calls)

    def test_unhealthy_timeout(self):
        f = FakeFleet({"a": "1", "b": "1"}, unhealthy=[("b", "2")])
        c = FakeClock()
        res = run(f, hosts=["a", "b"], clock=c, batch_sizes=[2], health={"checks": 2, "interval": 5, "timeout": 12})
        self.assertEqual((res["status"], res["reason"], res["failed_host"], res["failed_batch"]), ("rolled_back", "unhealthy", "b", 0))
        self.assertEqual(c.sleeps, [5, 5, 5])   # 15 >= 12 -> стоп после третьего раунда
        self.assertEqual(f.v, {"a": "1", "b": "1"})

    def test_health_exception_counts_as_unhealthy(self):
        f = FakeFleet(OLD, raise_health=["a"])
        res = run(f, hosts=["a"], health={"checks": 1, "interval": 1, "timeout": 3})
        self.assertEqual((res["status"], res["failed_host"], res["reason"]), ("rolled_back", "a", "unhealthy"))

    def test_failed_host_is_first_unhealthy(self):
        f = FakeFleet(OLD, unhealthy=[("b", "2"), ("c", "2")])
        res = run(f, hosts=["a", "b", "c"], batch_sizes=[3], health={"checks": 1, "interval": 1, "timeout": 1})
        self.assertEqual(res["failed_host"], "b")

    def test_rollback_new_host_uses_remove(self):
        f = FakeFleet({"a": "1"}, unhealthy=[("b", "2")])
        res = run(f, hosts=["a", "b"], batch_sizes=[1], health={"checks": 1, "interval": 1, "timeout": 1})
        self.assertEqual(res["rolled_back"], ["b", "a"])
        self.assertIn(("remove", "b"), f.calls)
        self.assertEqual(f.v, {"a": "1"})

    def test_rollback_skips_untouched_and_already_target(self):
        f = FakeFleet({"a": "2", "b": "1", "c": "1"}, unhealthy=[("b", "2")])
        res = run(f, hosts=["a", "b", "c"], batch_sizes=[1], health={"checks": 1, "interval": 1, "timeout": 1})
        self.assertEqual(res["rolled_back"], ["b"])
        self.assertEqual(f.v["a"], "2")
        self.assertNotIn(("deploy", "a", "2"), f.calls)

    def test_rollback_failure_continues(self):
        f = FakeFleet({"a": "1", "b": "1", "c": "1"}, unhealthy=[("c", "2")], fail_deploy=[("b", "1")])
        j = {}
        res = run(f, hosts=["a", "b", "c"], batch_sizes=[1], health={"checks": 1, "interval": 1, "timeout": 1}, journal=j)
        self.assertEqual(res["status"], "rollback_failed")
        self.assertEqual(res["stuck"], ["b"])
        self.assertEqual(res["rolled_back"], ["c", "a"])
        self.assertEqual(list(j["previous"]), ["b"])
        self.assertEqual(f.v, {"a": "1", "b": "2", "c": "1"})


class Journal(unittest.TestCase):
    def test_previous_written_before_deploy(self):
        j = {}
        f = FakeFleet(OLD, crash_on=("b", "2"))
        with self.assertRaises(Crash):
            run(f, hosts=["a", "b", "c"], batch_sizes=[1], journal=j)
        self.assertEqual(j["target"], "2")
        self.assertEqual(j["previous"], {"a": "1", "b": "1"})
        self.assertEqual(j["verified"], [0])

    def test_resume_after_crash(self):
        j = {}
        f = FakeFleet(OLD, crash_on=("b", "2"))
        with self.assertRaises(Crash):
            run(f, hosts=["a", "b", "c"], batch_sizes=[1], journal=j)
        f.crash_on = None
        f.calls.clear()
        res = run(f, hosts=["a", "b", "c"], batch_sizes=[1], journal=j)
        self.assertEqual(res["status"], "ok")
        self.assertEqual([c[1] for c in f.calls], ["b", "c"])
        self.assertEqual(res["deployed"], ["b", "c"])

    def test_rollback_after_resume_restores_original(self):
        j = {}
        f = FakeFleet({'a': '1', 'b': '1', 'c': '1'}, crash_on=("b", "2"))
        with self.assertRaises(Crash):
            run(f, hosts=["a", "b", "c"], batch_sizes=[1], journal=j)
        f.crash_on = None
        f.unhealthy = {("c", "2")}
        res = run(f, hosts=["a", "b", "c"], batch_sizes=[1], journal=j, health={"checks": 1, "interval": 1, "timeout": 1})
        self.assertEqual(res["status"], "rolled_back")
        self.assertEqual(f.v, {"a": "1", "b": "1", "c": "1"})
        self.assertEqual(res["rolled_back"], ["c", "b", "a"])
        self.assertEqual(j["previous"], {})
        self.assertEqual(j["verified"], [])

    def test_repeat_after_success_touches_nothing(self):
        j = {}
        f = FakeFleet(OLD)
        run(f, journal=j, batch_sizes=[2])
        f.calls.clear()
        f.health_calls.clear()
        c = FakeClock()
        res = run(f, clock=c, journal=j, batch_sizes=[2])
        self.assertEqual((f.calls, f.health_calls, c.sleeps), ([], [], []))
        self.assertEqual((res["status"], res["deployed"], res["elapsed"]), ("ok", [], 0))

    def test_journal_mismatch(self):
        j = {}
        run(FakeFleet(OLD), journal=j)
        with self.assertRaises(rollout.RolloutError) as cm:
            rollout.rollout(H, "3", FakeFleet(OLD), FakeClock(), journal=j)
        self.assertEqual(cm.exception.code, "journal_mismatch")

    def test_fresh_journal_checks_hosts_already_at_target(self):
        f = FakeFleet({h: "2" for h in H}, unhealthy=[("a", "2")])
        res = run(f, hosts=["a", "b"], health={"checks": 1, "interval": 1, "timeout": 1})
        self.assertEqual((res["status"], res["reason"], res["deployed"]), ("rolled_back", "unhealthy", []))
        self.assertEqual(f.calls, [])

    def test_retry_after_rollback_starts_over(self):
        j = {}
        f = FakeFleet(OLD, unhealthy=[("a", "2")])
        run(f, hosts=["a", "b"], journal=j, health={"checks": 1, "interval": 1, "timeout": 1})
        f.unhealthy = set()
        res = run(f, hosts=["a", "b"], journal=j)
        self.assertEqual((res["status"], res["deployed"]), ("ok", ["a", "b"]))


class Design(unittest.TestCase):
    def test_design_md_sections(self):
        path = os.path.join(os.path.dirname(os.path.abspath(rollout.__file__)), "DESIGN.md")
        self.assertTrue(os.path.exists(path), "нет DESIGN.md в корне репозитория")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for h in ("Решения", "Компромиссы", "Границы применимости"):
            m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
            self.assertIsNotNone(m, h)
            self.assertGreaterEqual(len(m.group(1).strip()), 200, h)


if __name__ == "__main__":
    unittest.main()
