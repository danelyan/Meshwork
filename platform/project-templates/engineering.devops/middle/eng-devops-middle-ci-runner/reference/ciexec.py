"""Исполнитель CI-пайплайна по контракту (contract.md)."""
import hashlib
import json


class PipelineError(ValueError):
    def __init__(self, code, details=None, message=""):
        super().__init__(message or code)
        self.code = code
        self.details = details if details is not None else []


def _steps(pipeline):
    bad = PipelineError("invalid_pipeline")
    if not isinstance(pipeline, dict) or not isinstance(pipeline.get("steps"), list):
        raise bad
    out = []
    for s in pipeline["steps"]:
        if not isinstance(s, dict):
            raise bad
        if not isinstance(s.get("id"), str) or not s["id"] or not isinstance(s.get("run"), str):
            raise bad
        needs = s.get("needs", [])
        inputs = s.get("inputs", [])
        retries = s.get("retries", 0)
        if not isinstance(needs, list) or not all(isinstance(n, str) for n in needs):
            raise bad
        if not isinstance(inputs, list) or not all(isinstance(n, str) for n in inputs):
            raise bad
        if not isinstance(retries, int) or isinstance(retries, bool) or retries < 0:
            raise bad
        if not isinstance(s.get("cache", True), bool):
            raise bad
        out.append(s)
    return out


def plan(pipeline: dict) -> list:
    steps = _steps(pipeline)
    ids = [s["id"] for s in steps]
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        raise PipelineError("duplicate_id", dups)
    known = set(ids)
    unknown = sorted([s["id"], n] for s in steps for n in s.get("needs", []) if n not in known)
    if unknown:
        raise PipelineError("unknown_dependency", unknown)
    pending = {s["id"]: set(s.get("needs", [])) for s in steps}
    order = []
    while True:
        nxt = next((i for i in ids if i in pending and not pending[i]), None)
        if nxt is None:
            break
        order.append(nxt)
        del pending[nxt]
        for deps in pending.values():
            deps.discard(nxt)
    if pending:
        raise PipelineError("cycle", sorted(pending))
    return order


def _key(step, files, dep_keys):
    inputs = sorted(set(step.get("inputs", [])))
    parts = [
        step["id"],
        step["run"],
        [[p, hashlib.sha256(files[p].encode("utf-8")).hexdigest() if p in files else None] for p in inputs],
        [[d, dep_keys[d]] for d in sorted(set(step.get("needs", [])))],
    ]
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode("utf-8")).hexdigest()


def run(pipeline: dict, executor, files=None, cache=None, max_parallel: int = 1) -> dict:
    order = plan(pipeline)
    if not isinstance(max_parallel, int) or isinstance(max_parallel, bool) or max_parallel < 1:
        raise ValueError("max_parallel must be an integer >= 1")
    files = files or {}
    if cache is None:
        cache = {}
    by_id = {s["id"]: s for s in pipeline["steps"]}
    rank = {i: n for n, i in enumerate(order)}
    result = {i: {"status": None, "start": None, "end": None, "attempts": 0, "cache_key": None} for i in order}
    keys = {}
    started = []
    running = []  # (end, rank, id, ok)
    waiting = list(order)
    now = 0

    def deps_state(i):
        states = [result[d]["status"] for d in by_id[i].get("needs", [])]
        if any(s in ("failed", "skipped") for s in states):
            return "skip"
        return "ready" if all(s in ("success", "cached") for s in states) else "wait"

    while waiting or running:
        progressed = True
        while progressed:
            progressed = False
            for i in list(waiting):
                st = deps_state(i)
                if st == "skip":
                    result[i]["status"] = "skipped"
                    waiting.remove(i)
                    progressed = True
                elif st == "ready":
                    step = by_id[i]
                    key = _key(step, files, keys)
                    keys[i] = key
                    if step.get("cache", True) and key in cache:
                        result[i].update(status="cached", start=now, end=now, cache_key=key)
                        started.append(i)
                        waiting.remove(i)
                        progressed = True
                    elif len(running) < max_parallel:
                        ok, total, attempts = False, 0, 0
                        for attempt in range(1, step.get("retries", 0) + 2):
                            attempts = attempt
                            try:
                                r = executor(step, attempt)
                                ok, d = bool(r["ok"]), r["duration"]
                            except Exception:
                                ok, d = False, 0
                            total += d
                            if ok:
                                break
                        result[i].update(start=now, end=now + total, attempts=attempts, cache_key=key)
                        running.append((now + total, rank[i], i, ok))
                        started.append(i)
                        waiting.remove(i)
                        progressed = True
                    # иначе ждёт слот
        if not running:
            break
        running.sort()
        end = running[0][0]
        while running and running[0][0] == end:
            _, _, i, ok = running.pop(0)
            result[i]["status"] = "success" if ok else "failed"
            if ok and by_id[i].get("cache", True):
                cache[keys[i]] = {"step": i}
        now = end
    counts = {k: 0 for k in ("success", "cached", "failed", "skipped")}
    for r in result.values():
        counts[r["status"]] += 1
    ran = [r["end"] for r in result.values() if r["status"] != "skipped"]
    return {"ok": counts["failed"] == 0, "makespan": max(ran) if ran else 0, "order": started, "counts": counts, "steps": result}
