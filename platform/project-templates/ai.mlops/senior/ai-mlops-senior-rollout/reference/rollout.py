"""Контроллер выкатки модели (эталон)."""
import copy
import hashlib
import json
import math
from statistics import fmean

EPS = 1e-9


def fingerprint(obj):
    s = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def bucket(seed, request_id):
    h = hashlib.sha256(f"{seed}:{request_id}".encode()).hexdigest()
    return int(h[:8], 16) % 100


def _is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _validate_policy(policy):
    if not isinstance(policy, dict):
        raise ValueError("policy")
    keys = {"stages", "min_samples", "hold_sec", "phase_timeout_sec", "rules"}
    if set(policy) != keys:
        raise ValueError("policy keys")
    st = policy["stages"]
    if not isinstance(st, (list, tuple)) or not st:
        raise ValueError("stages")
    prev = 0
    for s in st:
        if not isinstance(s, int) or isinstance(s, bool) or not 1 <= s <= 99 or s <= prev:
            raise ValueError("stages")
        prev = s
    ms = policy["min_samples"]
    if not isinstance(ms, int) or isinstance(ms, bool) or ms < 1:
        raise ValueError("min_samples")
    h = policy["hold_sec"]
    if not _is_num(h) or not math.isfinite(h) or h < 0:
        raise ValueError("hold_sec")
    t = policy["phase_timeout_sec"]
    if not _is_num(t) or not math.isfinite(t) or t <= 0:
        raise ValueError("phase_timeout_sec")
    rules = policy["rules"]
    if not isinstance(rules, dict) or not rules:
        raise ValueError("rules")
    for name, r in rules.items():
        if not isinstance(r, dict) or not {"direction", "max_regression"} <= set(r) or not set(r) <= {"direction", "max_regression", "limit"}:
            raise ValueError("rule keys")
        if r["direction"] not in ("higher", "lower"):
            raise ValueError("direction")
        mr = r["max_regression"]
        if not _is_num(mr) or not math.isfinite(mr) or mr < 0:
            raise ValueError("max_regression")
        if "limit" in r and (not _is_num(r["limit"]) or not math.isfinite(r["limit"])):
            raise ValueError("limit")


class RolloutController:
    def __init__(self, production, policy, clock, seed=0):
        _validate_policy(policy)
        self._policy = copy.deepcopy(policy)
        self._production = production
        self._clock = clock
        self._seed = seed
        self._state = "idle"
        self._candidate = None
        self._stage_idx = None
        self._phase_start = 0.0
        self._obs = {}
        self._run = None
        self._history = []

    def _log(self, event, **kw):
        self._history.append({"at": self._clock(), "event": event, **kw})

    def _reset_phase(self):
        self._phase_start = self._clock()
        self._obs = {self._production: [], self._candidate: []}

    def _stage(self):
        if self._state == "canary":
            return self._policy["stages"][self._stage_idx]
        return None

    def start(self, candidate, data_hash=None):
        if self._state in ("shadow", "canary"):
            raise RuntimeError("rollout in progress")
        if candidate == self._production:
            raise ValueError("candidate equals production")
        self._candidate = candidate
        self._state = "shadow"
        self._stage_idx = None
        self._reset_phase()
        cfg = fingerprint(self._policy)
        run = {"baseline": self._production, "candidate": candidate, "seed": self._seed,
               "config_hash": cfg, "data_hash": data_hash}
        run["run_id"] = fingerprint(dict(run))
        self._run = run
        self._log("start", candidate=candidate, run_id=run["run_id"])
        return dict(run)

    def route(self, request_id):
        if self._state == "shadow":
            return {"serve": self._production, "shadow": self._candidate}
        if self._state == "canary":
            to_cand = bucket(self._seed, request_id) < self._stage()
            return {"serve": self._candidate if to_cand else self._production, "shadow": None}
        return {"serve": self._production, "shadow": None}

    def _active(self):
        if self._state not in ("shadow", "canary"):
            raise RuntimeError("no active rollout")

    def observe(self, version, metrics):
        self._active()
        if version not in self._obs:
            raise ValueError("unknown version")
        if not isinstance(metrics, dict):
            raise ValueError("metrics")
        rec = {}
        for name in self._policy["rules"]:
            v = metrics.get(name)
            if not _is_num(v) or not math.isfinite(v):
                raise ValueError(f"metric {name}")
            rec[name] = v
        self._obs[version].append(rec)

    def _result(self, action, reason, comparison=None):
        return {"action": action, "reason": reason, "state": self._state,
                "stage": self._stage(), "comparison": comparison}

    def _finish_rollback(self, reason):
        self._state = "rolled_back"
        self._log("rollback", reason=reason)
        self._candidate = None
        self._stage_idx = None
        self._obs = {}

    def evaluate(self):
        self._active()
        p = self._policy
        base = self._obs[self._production]
        cand = self._obs[self._candidate]
        elapsed = self._clock() - self._phase_start
        if len(base) < p["min_samples"] or len(cand) < p["min_samples"]:
            if elapsed >= p["phase_timeout_sec"]:
                self._finish_rollback("timeout")
                return self._result("rollback", "timeout")
            return self._result("wait", "insufficient_samples")
        comparison = {}
        reason = None
        for name in sorted(p["rules"]):
            r = p["rules"][name]
            b = fmean(x[name] for x in base)
            c = fmean(x[name] for x in cand)
            reg = (b - c) if r["direction"] == "higher" else (c - b)
            lim_bad = False
            if "limit" in r:
                lim_bad = c < r["limit"] - EPS if r["direction"] == "higher" else c > r["limit"] + EPS
            reg_bad = reg > r["max_regression"] + EPS
            comparison[name] = {"candidate": c, "baseline": b, "regression": reg, "breach": reg_bad or lim_bad}
            if reason is None and reg_bad:
                reason = f"regression:{name}"
            elif reason is None and lim_bad:
                reason = f"limit:{name}"
        if reason is not None:
            self._finish_rollback(reason)
            return self._result("rollback", reason, comparison)
        if elapsed < p["hold_sec"]:
            return self._result("wait", "hold", comparison)
        nxt = 0 if self._state == "shadow" else self._stage_idx + 1
        if nxt < len(p["stages"]):
            self._state = "canary"
            self._stage_idx = nxt
            self._reset_phase()
            self._log("advance", stage=p["stages"][nxt])
            return self._result("advance", "ok", comparison)
        self._production, version = self._candidate, self._candidate
        self._state = "promoted"
        self._log("promote", version=version)
        self._candidate = None
        self._stage_idx = None
        self._obs = {}
        return self._result("promote", "ok", comparison)

    def rollback(self, reason="manual"):
        self._active()
        full = f"manual:{reason}"
        self._finish_rollback(full)
        return self._result("rollback", full)

    def status(self):
        counts = {"baseline": 0, "candidate": 0}
        if self._state in ("shadow", "canary"):
            counts = {"baseline": len(self._obs[self._production]), "candidate": len(self._obs[self._candidate])}
        return {"state": self._state, "production": self._production, "candidate": self._candidate,
                "stage": self._stage(), "samples": counts,
                "run": dict(self._run) if self._run else None}

    def history(self):
        return [dict(e) for e in self._history]
