# PLATFORM-OWNED: скрытые тесты платформы
import hashlib
import json
import unittest

import ciexec


class Exec:
    """script: id -> список исходов по попыткам (True / False / 'raise'); по умолчанию успех."""

    def __init__(self, durations=None, script=None):
        self.durations = durations or {}
        self.script = script or {}
        self.calls = []
        self.steps = []

    def __call__(self, step, attempt):
        self.calls.append((step["id"], attempt))
        self.steps.append(step)
        outcomes = self.script.get(step["id"], [True])
        o = outcomes[min(attempt, len(outcomes)) - 1]
        if o == "raise":
            raise RuntimeError("boom")
        return {"ok": o, "duration": self.durations.get(step["id"], 1)}


def pipe(*steps):
    return {"steps": [dict(s) for s in steps]}


def S(id, needs=(), **kw):
    d = {"id": id, "run": "cmd " + id}
    if needs:
        d["needs"] = list(needs)
    d.update(kw)
    return d


def err(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except ciexec.PipelineError as e:
        return e
    raise AssertionError("PipelineError не брошена")


class Plan(unittest.TestCase):
    def test_declared_order_among_ready(self):
        p = pipe(S("a"), S("b", ["c"]), S("c"), S("d"))
        self.assertEqual(ciexec.plan(p), ["a", "c", "b", "d"])

    def test_empty(self):
        self.assertEqual(ciexec.plan(pipe()), [])
        res = ciexec.run(pipe(), Exec())
        self.assertEqual((res["ok"], res["makespan"], res["order"]), (True, 0, []))

    def test_invalid_pipeline(self):
        bad = [
            None, {}, {"steps": "x"}, {"steps": [1]},
            pipe({"run": "x"}), pipe({"id": "", "run": "x"}), pipe({"id": "a"}), pipe({"id": "a", "run": 1}),
            pipe({"id": "a", "run": "x", "needs": "b"}), pipe(S("a", inputs=[1])), pipe(S("a", retries=-1)),
            pipe(S("a", retries=True)), pipe(S("a", retries=1.5)), pipe(S("a", cache="yes")),
        ]
        for p in bad:
            e = err(ciexec.plan, p)
            self.assertEqual((e.code, e.details), ("invalid_pipeline", []), p)

    def test_duplicate_id(self):
        e = err(ciexec.plan, pipe(S("b"), S("a"), S("b"), S("a"), S("c")))
        self.assertEqual((e.code, e.details), ("duplicate_id", ["a", "b"]))

    def test_unknown_dependency(self):
        e = err(ciexec.plan, pipe(S("b", ["x", "a"]), S("a", ["y"])))
        self.assertEqual((e.code, e.details), ("unknown_dependency", [["a", "y"], ["b", "x"]]))

    def test_cycle_details_include_dependents(self):
        p = pipe(S("ok"), S("a", ["c"]), S("b", ["a"]), S("c", ["b"]), S("tail", ["c"]))
        e = err(ciexec.plan, p)
        self.assertEqual((e.code, e.details), ("cycle", ["a", "b", "c", "tail"]))

    def test_self_dependency_is_cycle(self):
        e = err(ciexec.plan, pipe(S("a", ["a"])))
        self.assertEqual((e.code, e.details), ("cycle", ["a"]))

    def test_check_priority(self):
        e = err(ciexec.plan, pipe(S("a"), S("a", ["zz"])))
        self.assertEqual(e.code, "duplicate_id")
        e = err(ciexec.plan, pipe(S("a", ["zz"], retries=-1)))
        self.assertEqual(e.code, "invalid_pipeline")
        e = err(ciexec.plan, pipe(S("a", ["zz", "b"]), S("b", ["a"])))
        self.assertEqual(e.code, "unknown_dependency")

    def test_run_validates_before_executor(self):
        ex = Exec()
        e = err(ciexec.run, pipe(S("a"), S("b", ["c"]), S("c", ["b"])), ex)
        self.assertEqual(e.code, "cycle")
        self.assertEqual(ex.calls, [])

    def test_max_parallel_validation(self):
        for bad in (0, -1, True, 1.5, "2"):
            with self.assertRaises(ValueError) as cm:
                ciexec.run(pipe(S("a")), Exec(), max_parallel=bad)
            self.assertNotIsInstance(cm.exception, ciexec.PipelineError)


class Scheduling(unittest.TestCase):
    def test_sequential(self):
        ex = Exec({"a": 3, "b": 2, "c": 4})
        res = ciexec.run(pipe(S("a"), S("b"), S("c")), ex)
        self.assertEqual(res["makespan"], 9)
        self.assertEqual(res["order"], ["a", "b", "c"])
        self.assertEqual([(res["steps"][i]["start"], res["steps"][i]["end"]) for i in "abc"], [(0, 3), (3, 5), (5, 9)])

    def test_limit_two(self):
        ex = Exec({"a": 3, "b": 2, "c": 4})
        res = ciexec.run(pipe(S("a"), S("b"), S("c")), ex, max_parallel=2)
        self.assertEqual(res["makespan"], 6)
        self.assertEqual([(res["steps"][i]["start"], res["steps"][i]["end"]) for i in "abc"], [(0, 3), (0, 2), (2, 6)])

    def test_unlimited_enough(self):
        ex = Exec({"a": 3, "b": 2, "c": 4})
        res = ciexec.run(pipe(S("a"), S("b"), S("c")), ex, max_parallel=3)
        self.assertEqual(res["makespan"], 4)

    def test_diamond(self):
        p = pipe(S("root"), S("l", ["root"]), S("r", ["root"]), S("join", ["l", "r"]))
        d = {"root": 1, "l": 2, "r": 3, "join": 1}
        res = ciexec.run(p, Exec(d), max_parallel=2)
        self.assertEqual(res["makespan"], 5)
        self.assertEqual((res["steps"]["join"]["start"], res["steps"]["join"]["end"]), (4, 5))
        self.assertEqual(res["order"], ["root", "l", "r", "join"])
        res = ciexec.run(p, Exec(d), max_parallel=1)
        self.assertEqual(res["makespan"], 7)
        self.assertEqual(res["steps"]["r"]["start"], 3)

    def test_simultaneous_finish_fills_all_slots(self):
        p = pipe(S("a"), S("b"), S("x"), S("y"))
        res = ciexec.run(p, Exec({"a": 2, "b": 2, "x": 1, "y": 1}), max_parallel=2)
        self.assertEqual((res["steps"]["x"]["start"], res["steps"]["y"]["start"]), (2, 2))
        self.assertEqual(res["makespan"], 3)

    def test_zero_duration(self):
        p = pipe(S("a"), S("b", ["a"]))
        res = ciexec.run(p, Exec({"a": 0, "b": 0}))
        self.assertEqual((res["makespan"], res["steps"]["b"]["start"], res["steps"]["b"]["status"]), (0, 0, "success"))


class Retries(unittest.TestCase):
    def test_retry_until_success(self):
        ex = Exec({"a": 2}, {"a": [False, False, True]})
        p = pipe(S("a", retries=2))
        res = ciexec.run(p, ex)
        self.assertEqual(ex.calls, [("a", 1), ("a", 2), ("a", 3)])
        self.assertEqual(ex.steps[0], p["steps"][0])
        st = res["steps"]["a"]
        self.assertEqual((st["status"], st["attempts"], st["start"], st["end"]), ("success", 3, 0, 6))

    def test_retries_exhausted(self):
        ex = Exec({"a": 1}, {"a": [False]})
        res = ciexec.run(pipe(S("a", retries=2)), ex)
        st = res["steps"]["a"]
        self.assertEqual((st["status"], st["attempts"], st["end"]), ("failed", 3, 3))
        self.assertEqual(len(ex.calls), 3)

    def test_executor_exception_is_failed_attempt_zero_duration(self):
        ex = Exec({"a": 4}, {"a": ["raise", True]})
        res = ciexec.run(pipe(S("a", retries=1)), ex)
        st = res["steps"]["a"]
        self.assertEqual((st["status"], st["attempts"], st["end"]), ("success", 2, 4))
        ex = Exec({"a": 4}, {"a": ["raise"]})
        res = ciexec.run(pipe(S("a")), ex)
        self.assertEqual((res["steps"]["a"]["status"], res["steps"]["a"]["end"]), ("failed", 0))


class Failures(unittest.TestCase):
    def test_skip_transitive_independent_continue(self):
        p = pipe(S("a"), S("b", ["a"]), S("c", ["b"]), S("d"))
        ex = Exec({"a": 2, "d": 5}, {"a": [False]})
        res = ciexec.run(p, ex)
        self.assertFalse(res["ok"])
        self.assertEqual(ex.calls, [("a", 1), ("d", 1)])
        self.assertEqual(res["counts"], {"success": 1, "cached": 0, "failed": 1, "skipped": 2})
        self.assertEqual(res["order"], ["a", "d"])
        for i in "bc":
            st = res["steps"][i]
            self.assertEqual((st["status"], st["start"], st["end"], st["attempts"], st["cache_key"]), ("skipped", None, None, 0, None))
        self.assertEqual(res["makespan"], 7)
        self.assertIsNotNone(res["steps"]["a"]["cache_key"])

    def test_skip_when_one_of_two_deps_fails(self):
        p = pipe(S("a"), S("b"), S("c", ["a", "b"]))
        ex = Exec({"a": 1, "b": 5}, {"a": [False]})
        res = ciexec.run(p, ex, max_parallel=2)
        self.assertEqual(res["steps"]["c"]["status"], "skipped")
        self.assertEqual(res["makespan"], 5)

    def test_failed_not_cached(self):
        cache = {}
        ciexec.run(pipe(S("a"), S("b", ["a"])), Exec(script={"a": [False]}), cache=cache)
        self.assertEqual(cache, {})
        ex = Exec()
        ciexec.run(pipe(S("a"), S("b", ["a"])), ex, cache=cache)
        self.assertEqual(ex.calls, [("a", 1), ("b", 1)])


def expected_key(step, files, dep_keys):
    parts = [
        step["id"], step["run"],
        [[p, hashlib.sha256(files[p].encode()).hexdigest() if p in files else None] for p in sorted(step.get("inputs", []))],
        [[d, dep_keys[d]] for d in sorted(step.get("needs", []))],
    ]
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode()).hexdigest()


PIPE3 = pipe(S("lint"), S("build", ["lint"], inputs=["src/a.c", "src/missing.c"]), S("test", ["build"]))


class Cache(unittest.TestCase):
    def test_key_formula(self):
        files = {"src/a.c": "int a;"}
        cache = {}
        res = ciexec.run(PIPE3, Exec(), files=files, cache=cache)
        k_lint = expected_key(PIPE3["steps"][0], files, {})
        k_build = expected_key(PIPE3["steps"][1], files, {"lint": k_lint})
        k_test = expected_key(PIPE3["steps"][2], files, {"build": k_build})
        self.assertEqual([res["steps"][i]["cache_key"] for i in ("lint", "build", "test")], [k_lint, k_build, k_test])
        self.assertEqual(cache, {k_lint: {"step": "lint"}, k_build: {"step": "build"}, k_test: {"step": "test"}})

    def test_second_run_all_cached_zero_time(self):
        files = {"src/a.c": "int a;"}
        cache = {}
        first = ciexec.run(PIPE3, Exec(), files=files, cache=cache)
        ex = Exec()
        res = ciexec.run(PIPE3, ex, files=files, cache=cache)
        self.assertEqual(ex.calls, [])
        self.assertEqual(res["counts"], {"success": 0, "cached": 3, "failed": 0, "skipped": 0})
        self.assertEqual(res["order"], ["lint", "build", "test"])
        st = res["steps"]["build"]
        self.assertEqual((st["status"], st["start"], st["end"], st["attempts"]), ("cached", 0, 0, 0))
        self.assertEqual(st["cache_key"], first["steps"]["build"]["cache_key"])
        self.assertTrue(res["ok"])

    def test_input_change_invalidates_dependents_only(self):
        cache = {}
        ciexec.run(PIPE3, Exec(), files={"src/a.c": "v1"}, cache=cache)
        ex = Exec()
        res = ciexec.run(PIPE3, ex, files={"src/a.c": "v2"}, cache=cache)
        self.assertEqual(ex.calls, [("build", 1), ("test", 1)])
        self.assertEqual(res["steps"]["lint"]["status"], "cached")

    def test_command_change_invalidates(self):
        cache = {}
        ciexec.run(PIPE3, Exec(), cache=cache)
        p2 = pipe(S("lint"), S("build", ["lint"], inputs=["src/a.c", "src/missing.c"], run="other"), S("test", ["build"]))
        ex = Exec()
        ciexec.run(p2, ex, cache=cache)
        self.assertEqual(ex.calls, [("build", 1), ("test", 1)])

    def test_missing_file_differs_from_present(self):
        cache = {}
        ciexec.run(PIPE3, Exec(), files={}, cache=cache)
        ex = Exec()
        ciexec.run(PIPE3, ex, files={"src/missing.c": ""}, cache=cache)
        self.assertEqual([c[0] for c in ex.calls], ["build", "test"])

    def test_cache_false_always_runs_and_not_stored(self):
        p = pipe(S("a", cache=False), S("b", ["a"]))
        cache = {}
        ciexec.run(p, Exec(), cache=cache)
        self.assertEqual(len(cache), 1)
        ex = Exec()
        res = ciexec.run(p, ex, cache=cache)
        self.assertEqual(ex.calls, [("a", 1)])
        self.assertEqual((res["steps"]["a"]["status"], res["steps"]["b"]["status"]), ("success", "cached"))
        self.assertIsNotNone(res["steps"]["a"]["cache_key"])

    def test_cached_step_takes_no_slot_and_waits_for_dependency(self):
        p = pipe(S("x"), S("y", ["x"]), S("b", cache=False), S("c", cache=False))
        cache = {}
        d = {"x": 2, "b": 5, "c": 5}
        first = ciexec.run(p, Exec(d), cache=cache)
        del cache[first["steps"]["x"]["cache_key"]]
        ex = Exec(d)
        res = ciexec.run(p, ex, cache=cache, max_parallel=1)
        self.assertEqual(res["steps"]["y"]["status"], "cached")
        self.assertEqual(res["steps"]["y"]["start"], res["steps"]["x"]["end"])
        self.assertEqual(res["makespan"], 12)  # x 0-2, b 2-7, c 7-12; y из кеша слот не занимал
        self.assertEqual([c[0] for c in ex.calls], ["x", "b", "c"])

    def test_default_cache_and_files(self):
        res = ciexec.run(pipe(S("a", inputs=["f"])), Exec())
        self.assertTrue(res["ok"])


if __name__ == "__main__":
    unittest.main()
