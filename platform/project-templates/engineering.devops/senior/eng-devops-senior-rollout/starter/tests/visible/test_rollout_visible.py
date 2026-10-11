# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import unittest

import rollout


class FakeClock:
    def __init__(self):
        self.t = 0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += s


class FakeFleet:
    def __init__(self, versions, bad_after=None):
        self.v = dict(versions)
        self.bad = set(bad_after or [])
        self.calls = []

    def version(self, host):
        return self.v.get(host)

    def deploy(self, host, version):
        self.calls.append(("deploy", host, version))
        self.v[host] = version

    def remove(self, host):
        self.calls.append(("remove", host))
        self.v.pop(host, None)

    def healthy(self, host):
        return not (host in self.bad and self.v.get(host) == "2.0")


HOSTS = ["a", "b", "c", "d", "e"]


class RolloutVisible(unittest.TestCase):
    def test_plan_batches(self):
        self.assertEqual(rollout.plan_batches(list("abcdefg"), [1, 2, 4]), [["a"], ["b", "c"], ["d", "e", "f", "g"]])
        self.assertEqual(rollout.plan_batches(list("abcde"), [2]), [["a", "b"], ["c", "d"], ["e"]])

    def test_successful_rollout(self):
        fleet = FakeFleet({h: "1.0" for h in HOSTS})
        clock = FakeClock()
        res = rollout.rollout(HOSTS, "2.0", fleet, clock, batch_sizes=[1, 2])
        self.assertEqual(res["status"], "ok")
        self.assertEqual(res["deployed"], HOSTS)
        self.assertEqual(set(fleet.v.values()), {"2.0"})
        self.assertEqual(res["elapsed"], clock.t)

    def test_unhealthy_batch_rolls_back(self):
        fleet = FakeFleet({h: "1.0" for h in HOSTS}, bad_after=["c"])
        res = rollout.rollout(HOSTS, "2.0", fleet, FakeClock(), batch_sizes=[1, 2])
        self.assertEqual(res["status"], "rolled_back")
        self.assertEqual((res["failed_batch"], res["failed_host"], res["reason"]), (1, "c", "unhealthy"))
        self.assertEqual(res["rolled_back"], ["c", "b", "a"])
        self.assertEqual(set(fleet.v.values()), {"1.0"})

    def test_repeat_after_success_is_noop(self):
        fleet = FakeFleet({h: "1.0" for h in HOSTS})
        journal = {}
        rollout.rollout(HOSTS, "2.0", fleet, FakeClock(), journal=journal)
        n = len(fleet.calls)
        res = rollout.rollout(HOSTS, "2.0", fleet, FakeClock(), journal=journal)
        self.assertEqual((res["status"], res["deployed"], res["elapsed"]), ("ok", [], 0))
        self.assertEqual(len(fleet.calls), n)


if __name__ == "__main__":
    unittest.main()
