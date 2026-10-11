# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import copy
import hashlib
import json
import math
import re
from pathlib import Path

import pytest

from rollout import RolloutController, bucket, fingerprint

POLICY = {
    "stages": [10, 50],
    "min_samples": 3,
    "hold_sec": 100,
    "phase_timeout_sec": 1000,
    "rules": {
        "accuracy": {"direction": "higher", "max_regression": 0.02, "limit": 0.8},
        "latency_ms": {"direction": "lower", "max_regression": 10},
    },
}


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make(policy=None, seed=0, prod="v1"):
    clk = Clock()
    return RolloutController(prod, copy.deepcopy(policy or POLICY), clk, seed=seed), clk


def feed(c, n=3, base=(0.9, 100), cand=(0.9, 100), bv="v1", cv="v2"):
    for _ in range(n):
        c.observe(bv, {"accuracy": base[0], "latency_ms": base[1]})
        c.observe(cv, {"accuracy": cand[0], "latency_ms": cand[1]})


def to_canary(c, clk):
    c.start("v2")
    feed(c)
    clk.t += 100
    assert c.evaluate()["action"] == "advance"


def test_fingerprint_canonical_and_order_independent():
    a = {"b": [1, 2], "a": "я", "c": None}
    s = json.dumps(a, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert fingerprint(a) == hashlib.sha256(s.encode("utf-8")).hexdigest()
    assert fingerprint({"c": None, "a": "я", "b": (1, 2)}) == fingerprint(a)
    assert fingerprint({"a": 1}) != fingerprint({"a": 2})


def test_bucket_formula_and_range():
    for seed, rid in [(0, "a"), (42, "request-17"), (-3, "")]:
        want = int(hashlib.sha256(f"{seed}:{rid}".encode()).hexdigest()[:8], 16) % 100
        assert bucket(seed, rid) == want
    assert all(0 <= bucket(1, f"r{i}") < 100 for i in range(200))


def test_policy_validation():
    bad_policies = []
    for key, val in [
        ("stages", []), ("stages", [50, 10]), ("stages", [10, 10]), ("stages", [0]), ("stages", [100]),
        ("stages", [True]), ("stages", [10.5]), ("min_samples", 0), ("min_samples", True),
        ("hold_sec", -1), ("phase_timeout_sec", 0), ("rules", {}),
    ]:
        p = copy.deepcopy(POLICY)
        p[key] = val
        bad_policies.append(p)
    p = copy.deepcopy(POLICY)
    p["extra"] = 1
    bad_policies.append(p)
    p = copy.deepcopy(POLICY)
    del p["hold_sec"]
    bad_policies.append(p)
    p = copy.deepcopy(POLICY)
    p["rules"]["accuracy"]["direction"] = "up"
    bad_policies.append(p)
    p = copy.deepcopy(POLICY)
    p["rules"]["accuracy"]["max_regression"] = -0.1
    bad_policies.append(p)
    p = copy.deepcopy(POLICY)
    p["rules"]["accuracy"]["oops"] = 1
    bad_policies.append(p)
    for bp in bad_policies:
        with pytest.raises(ValueError):
            RolloutController("v1", bp, Clock())


def test_policy_is_copied():
    p = copy.deepcopy(POLICY)
    c = RolloutController("v1", p, Clock())
    p["min_samples"] = 1
    p["rules"]["accuracy"]["max_regression"] = 5
    c.start("v2")
    feed(c, n=2, cand=(0.5, 100))
    assert c.evaluate()["reason"] == "insufficient_samples"


def test_start_metadata_and_run_id_reproducible():
    c1, _ = make(seed=5)
    c2, _ = make(seed=5)
    m1 = c1.start("v2", data_hash="d1")
    m2 = c2.start("v2", data_hash="d1")
    assert m1 == m2
    assert m1["config_hash"] == fingerprint(POLICY)
    assert m1["baseline"] == "v1" and m1["candidate"] == "v2" and m1["seed"] == 5 and m1["data_hash"] == "d1"
    want = fingerprint({k: m1[k] for k in ("baseline", "candidate", "seed", "config_hash", "data_hash")})
    assert m1["run_id"] == want
    assert c1.status()["run"] == m1


def test_run_id_changes_with_any_input():
    base = make(seed=5)[0].start("v2", data_hash="d1")["run_id"]
    assert make(seed=6)[0].start("v2", data_hash="d1")["run_id"] != base
    assert make(seed=5)[0].start("v2", data_hash="d2")["run_id"] != base
    assert make(seed=5)[0].start("v2")["run_id"] != base
    assert make(seed=5)[0].start("v3", data_hash="d1")["run_id"] != base
    p = copy.deepcopy(POLICY)
    p["hold_sec"] = 101
    assert make(p, seed=5)[0].start("v2", data_hash="d1")["run_id"] != base


def test_start_state_rules():
    c, clk = make()
    with pytest.raises(ValueError):
        c.start("v1")
    c.start("v2")
    with pytest.raises(RuntimeError):
        c.start("v3")
    c.rollback()
    c.start("v3")
    assert c.status()["candidate"] == "v3"


def test_route_by_state():
    c, clk = make(seed=3)
    assert c.route("r") == {"serve": "v1", "shadow": None}
    c.start("v2")
    assert all(c.route(f"r{i}") == {"serve": "v1", "shadow": "v2"} for i in range(5))
    feed(c)
    clk.t = 100
    c.evaluate()
    got = [c.route(f"req-{i}") for i in range(300)]
    for i, r in enumerate(got):
        want = "v2" if bucket(3, f"req-{i}") < 10 else "v1"
        assert r == {"serve": want, "shadow": None}
    assert 0 < sum(r["serve"] == "v2" for r in got) < 100


def test_route_sticky_and_monotonic_across_stages():
    c, clk = make(seed=9)
    to_canary(c, clk)
    ids = [f"u{i}" for i in range(400)]
    first = {i: c.route(i)["serve"] for i in ids}
    assert first == {i: c.route(i)["serve"] for i in ids}
    feed(c)
    clk.t += 100
    assert c.evaluate()["stage"] == 50
    second = {i: c.route(i)["serve"] for i in ids}
    assert all(second[i] == "v2" for i in ids if first[i] == "v2")
    assert sum(v == "v2" for v in second.values()) > sum(v == "v2" for v in first.values())


def test_seed_changes_assignment():
    a, ca = make(seed=1)
    b, cb = make(seed=2)
    for c, clk in ((a, ca), (b, cb)):
        to_canary(c, clk)
    ids = [f"x{i}" for i in range(300)]
    assert [a.route(i)["serve"] for i in ids] != [b.route(i)["serve"] for i in ids]


def test_observe_validation():
    c, _ = make()
    with pytest.raises(RuntimeError):
        c.observe("v1", {"accuracy": 1, "latency_ms": 1})
    c.start("v2")
    ok = {"accuracy": 0.9, "latency_ms": 100}
    with pytest.raises(ValueError):
        c.observe("v9", ok)
    with pytest.raises(ValueError):
        c.observe("v1", {"accuracy": 0.9})
    with pytest.raises(ValueError):
        c.observe("v1", {"accuracy": float("nan"), "latency_ms": 1})
    with pytest.raises(ValueError):
        c.observe("v1", {"accuracy": math.inf, "latency_ms": 1})
    with pytest.raises(ValueError):
        c.observe("v1", {"accuracy": True, "latency_ms": 1})
    assert c.status()["samples"] == {"baseline": 0, "candidate": 0}
    c.observe("v1", {**ok, "extra": "ignored"})
    assert c.status()["samples"] == {"baseline": 1, "candidate": 0}


def test_wait_for_samples_then_timeout_boundary():
    c, clk = make()
    c.start("v2")
    for _ in range(5):
        c.observe("v2", {"accuracy": 0.9, "latency_ms": 100})
    feed(c, n=2)
    r = c.evaluate()
    assert (r["action"], r["reason"], r["comparison"]) == ("wait", "insufficient_samples", None)
    clk.t = 999
    assert c.evaluate()["action"] == "wait"
    clk.t = 1000
    r = c.evaluate()
    assert (r["action"], r["reason"], r["state"]) == ("rollback", "timeout", "rolled_back")
    assert c.status()["production"] == "v1"


def test_hold_blocks_advance_but_not_rollback():
    c, clk = make()
    c.start("v2")
    feed(c)
    clk.t = 99
    r = c.evaluate()
    assert (r["action"], r["reason"]) == ("wait", "hold")
    assert r["comparison"]["accuracy"]["breach"] is False
    clk.t = 100
    assert c.evaluate()["action"] == "advance"
    c2, clk2 = make()
    c2.start("v2")
    feed(c2, cand=(0.9, 130))
    r = c2.evaluate()
    assert (r["action"], r["reason"]) == ("rollback", "regression:latency_ms")


def test_regression_threshold_boundary_and_directions():
    c, clk = make()
    c.start("v2")
    feed(c, base=(0.90, 100), cand=(0.88, 110))
    clk.t = 100
    r = c.evaluate()
    assert r["action"] == "advance"
    assert r["comparison"]["accuracy"]["regression"] == pytest.approx(0.02)
    assert r["comparison"]["latency_ms"]["regression"] == pytest.approx(10)
    c2, _ = make()
    c2.start("v2")
    feed(c2, base=(0.90, 100), cand=(0.879, 100))
    assert c2.evaluate()["reason"] == "regression:accuracy"
    c3, clk3 = make()
    c3.start("v2")
    feed(c3, base=(0.90, 100), cand=(0.95, 40))
    clk3.t = 100
    r = c3.evaluate()
    assert r["action"] == "advance" and r["comparison"]["latency_ms"]["regression"] == pytest.approx(-60)


def test_limit_breach_without_regression_and_reason_order():
    c, _ = make()
    c.start("v2")
    feed(c, base=(0.78, 100), cand=(0.78, 100))
    r = c.evaluate()
    assert (r["action"], r["reason"]) == ("rollback", "limit:accuracy")
    assert r["comparison"]["accuracy"]["breach"] is True
    c2, _ = make()
    c2.start("v2")
    feed(c2, base=(0.95, 100), cand=(0.70, 200))
    r = c2.evaluate()
    assert r["reason"] == "regression:accuracy"
    assert r["comparison"]["latency_ms"]["breach"] is True


def test_means_over_mixed_observations():
    c, clk = make()
    c.start("v2")
    for a in (0.8, 0.9, 1.0):
        c.observe("v1", {"accuracy": a, "latency_ms": 100})
    for a, l in ((0.88, 90), (0.92, 110), (0.90, 100), (0.90, 100)):
        c.observe("v2", {"accuracy": a, "latency_ms": l})
    clk.t = 100
    r = c.evaluate()
    assert r["comparison"]["accuracy"]["candidate"] == pytest.approx(0.9)
    assert r["comparison"]["accuracy"]["baseline"] == pytest.approx(0.9)
    assert r["action"] == "advance"


def test_phase_resets_samples_and_timer():
    c, clk = make()
    to_canary(c, clk)
    assert c.status()["samples"] == {"baseline": 0, "candidate": 0}
    feed(c, n=2)
    r = c.evaluate()
    assert (r["action"], r["reason"], r["stage"]) == ("wait", "insufficient_samples", 10)
    clk.t = 100 + 999
    assert c.evaluate()["action"] == "wait"
    clk.t = 100 + 1000
    assert c.evaluate()["reason"] == "timeout"
    assert c.status()["stage"] is None


def test_canary_regression_uses_only_current_phase():
    c, clk = make()
    c.start("v2")
    feed(c)
    clk.t = 100
    assert c.evaluate()["action"] == "advance"
    feed(c, cand=(0.9, 100))
    clk.t = 200
    r = c.evaluate()
    assert (r["action"], r["stage"]) == ("advance", 50)
    feed(c, cand=(0.91, 90))
    clk.t = 300
    r = c.evaluate()
    assert (r["action"], r["state"], r["stage"]) == ("promote", "promoted", None)
    s = c.status()
    assert (s["production"], s["candidate"], s["samples"]) == ("v2", None, {"baseline": 0, "candidate": 0})
    assert c.route("any") == {"serve": "v2", "shadow": None}


def test_manual_rollback_and_state_errors():
    c, clk = make()
    with pytest.raises(RuntimeError):
        c.evaluate()
    with pytest.raises(RuntimeError):
        c.rollback()
    to_canary(c, clk)
    r = c.rollback("ops")
    assert r == {"action": "rollback", "reason": "manual:ops", "state": "rolled_back", "stage": None, "comparison": None}
    assert c.route("r") == {"serve": "v1", "shadow": None}
    for fn in (c.evaluate, c.rollback, lambda: c.observe("v1", {"accuracy": 1, "latency_ms": 1})):
        with pytest.raises(RuntimeError):
            fn()


def test_second_rollout_after_promotion_uses_new_baseline():
    c, clk = make()
    c.start("v2")
    for _ in range(3):
        feed(c)
        clk.t += 100
        r = c.evaluate()
    assert r["action"] == "promote"
    m = c.start("v3")
    assert m["baseline"] == "v2"
    assert c.route("r") == {"serve": "v2", "shadow": "v3"}
    with pytest.raises(ValueError):
        c.observe("v1", {"accuracy": 0.9, "latency_ms": 100})
    feed(c, bv="v2", cv="v3", cand=(0.7, 100))
    assert c.evaluate()["reason"] == "regression:accuracy"


def test_history_events_with_clock_values():
    c, clk = make()
    clk.t = 5
    run = c.start("v2")
    feed(c)
    clk.t = 105
    c.evaluate()
    clk.t = 120
    c.rollback("x")
    h = c.history()
    assert [e["event"] for e in h] == ["start", "advance", "rollback"]
    assert [e["at"] for e in h] == [5, 105, 120]
    assert h[0]["candidate"] == "v2" and h[0]["run_id"] == run["run_id"]
    assert h[1]["stage"] == 10 and h[2]["reason"] == "manual:x"
    h.append({"event": "fake"})
    h[0]["event"] = "changed"
    assert [e["event"] for e in c.history()] == ["start", "advance", "rollback"]


def test_promote_event_and_no_wall_clock():
    c, clk = make()
    c.start("v2")
    for _ in range(3):
        feed(c)
        clk.t += 100
        c.evaluate()
    assert c.history()[-1] == {"at": 300, "event": "promote", "version": "v2"}


def test_design_md_sections():
    path = Path(__file__).resolve().parent.parent / "DESIGN.md"
    assert path.exists()
    text = path.read_text(encoding="utf-8")
    for h in ("Решения", "Компромиссы", "Границы применимости"):
        m = re.search(rf"^## {h}[ \t]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
        assert m, h
        assert len(m.group(1).strip()) >= 200, h
