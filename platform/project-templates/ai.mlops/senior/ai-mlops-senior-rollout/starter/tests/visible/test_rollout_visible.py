# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import hashlib

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


def feed(c, base, cand, n=3, base_m=(0.9, 100), cand_m=(0.9, 100)):
    for _ in range(n):
        c.observe(base, {"accuracy": base_m[0], "latency_ms": base_m[1]})
        c.observe(cand, {"accuracy": cand_m[0], "latency_ms": cand_m[1]})


def test_fingerprint_and_bucket_follow_contract():
    s = '{"a":1,"b":[1,2]}'
    assert fingerprint({"b": (1, 2), "a": 1}) == hashlib.sha256(s.encode()).hexdigest()
    want = int(hashlib.sha256(b"7:req-1").hexdigest()[:8], 16) % 100
    assert bucket(7, "req-1") == want


def test_full_rollout_to_promotion():
    clk = Clock()
    c = RolloutController("v1", POLICY, clk, seed=1)
    meta = c.start("v2", data_hash="abc")
    assert meta["run_id"] and c.status()["state"] == "shadow"
    assert c.route("r1") == {"serve": "v1", "shadow": "v2"}
    feed(c, "v1", "v2")
    assert c.evaluate()["reason"] == "hold"
    clk.t = 100
    r = c.evaluate()
    assert (r["action"], r["state"], r["stage"]) == ("advance", "canary", 10)
    for stage in (50, None):
        feed(c, "v1", "v2")
        clk.t += 100
        r = c.evaluate()
    assert r["action"] == "promote" and c.status()["production"] == "v2"


def test_regression_rolls_back_immediately():
    clk = Clock()
    c = RolloutController("v1", POLICY, clk)
    c.start("v2")
    feed(c, "v1", "v2", cand_m=(0.85, 100))
    r = c.evaluate()
    assert (r["action"], r["reason"], r["state"]) == ("rollback", "regression:accuracy", "rolled_back")
    assert c.status()["production"] == "v1"


def test_wait_then_timeout_without_samples():
    clk = Clock()
    c = RolloutController("v1", POLICY, clk)
    c.start("v2")
    c.observe("v2", {"accuracy": 0.9, "latency_ms": 100})
    assert c.evaluate()["reason"] == "insufficient_samples"
    clk.t = 1000
    assert c.evaluate()["reason"] == "timeout"


def test_invalid_policy_and_observation():
    bad = dict(POLICY, stages=[50, 10])
    with pytest.raises(ValueError):
        RolloutController("v1", bad, Clock())
    c = RolloutController("v1", POLICY, Clock())
    with pytest.raises(RuntimeError):
        c.observe("v1", {"accuracy": 1, "latency_ms": 1})
