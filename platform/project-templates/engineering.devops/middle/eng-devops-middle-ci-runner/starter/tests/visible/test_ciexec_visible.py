# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import unittest

import ciexec


class Exec:
    def __init__(self, durations=None, fail=()):
        self.durations = durations or {}
        self.fail = set(fail)
        self.calls = []

    def __call__(self, step, attempt):
        self.calls.append((step["id"], attempt))
        return {"ok": step["id"] not in self.fail, "duration": self.durations.get(step["id"], 1)}


PIPE = {"steps": [
    {"id": "lint", "run": "make lint"},
    {"id": "build", "run": "make build", "needs": ["lint"], "inputs": ["src/app.c"]},
    {"id": "test", "run": "make test", "needs": ["build"]},
]}


class CiExecVisible(unittest.TestCase):
    def test_plan_order(self):
        pipe = {"steps": [{"id": "b", "run": "x", "needs": ["a"]}, {"id": "a", "run": "x"}]}
        self.assertEqual(ciexec.plan(pipe), ["a", "b"])

    def test_cycle(self):
        pipe = {"steps": [{"id": "a", "run": "x", "needs": ["b"]}, {"id": "b", "run": "x", "needs": ["a"]}]}
        with self.assertRaises(ciexec.PipelineError) as cm:
            ciexec.plan(pipe)
        self.assertEqual((cm.exception.code, cm.exception.details), ("cycle", ["a", "b"]))

    def test_failure_skips_dependents(self):
        res = ciexec.run(PIPE, Exec(fail=["build"]), files={"src/app.c": "int x;"})
        self.assertFalse(res["ok"])
        self.assertEqual(res["counts"], {"success": 1, "cached": 0, "failed": 1, "skipped": 1})
        self.assertEqual(res["steps"]["test"]["status"], "skipped")

    def test_second_run_is_cached(self):
        cache = {}
        ciexec.run(PIPE, Exec(), files={"src/app.c": "int x;"}, cache=cache)
        ex = Exec()
        res = ciexec.run(PIPE, ex, files={"src/app.c": "int x;"}, cache=cache)
        self.assertEqual(ex.calls, [])
        self.assertEqual(res["counts"]["cached"], 3)
        self.assertEqual(res["makespan"], 0)


if __name__ == "__main__":
    unittest.main()
