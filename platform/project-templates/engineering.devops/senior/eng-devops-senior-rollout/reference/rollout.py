"""Оркестратор поэтапной выкатки — эталонное решение."""

DEFAULT_HEALTH = {"checks": 2, "interval": 5, "timeout": 30}


class RolloutError(ValueError):
    def __init__(self, code, message=""):
        super().__init__(message or code)
        self.code = code


def _is_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def _is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _check_hosts(hosts):
    if (not isinstance(hosts, list) or not hosts
            or any(not isinstance(h, str) or not h for h in hosts)
            or len(set(hosts)) != len(hosts)):
        raise RolloutError("invalid_hosts")


def _check_sizes(sizes):
    if (not isinstance(sizes, (list, tuple)) or not sizes
            or any(not _is_int(s) or s < 1 for s in sizes)):
        raise RolloutError("invalid_batches")


def plan_batches(hosts, sizes):
    _check_hosts(hosts)
    _check_sizes(sizes)
    batches, i, n = [], 0, 0
    while i < len(hosts):
        size = sizes[n] if n < len(sizes) else sizes[-1]
        batches.append(hosts[i:i + size])
        i += size
        n += 1
    return batches


def _health(h):
    cfg = dict(DEFAULT_HEALTH)
    if h is not None:
        if not isinstance(h, dict) or set(h) - set(cfg):
            raise RolloutError("invalid_health")
        cfg.update(h)
    if (not _is_int(cfg["checks"]) or cfg["checks"] < 1
            or not _is_num(cfg["interval"]) or cfg["interval"] <= 0
            or not _is_num(cfg["timeout"]) or cfg["timeout"] < cfg["interval"]):
        raise RolloutError("invalid_health")
    return cfg


def rollout(hosts, target, fleet, clock, batch_sizes=(1,), health=None, journal=None):
    _check_hosts(hosts)
    if not isinstance(target, str) or not target:
        raise RolloutError("invalid_target")
    _check_sizes(batch_sizes)
    cfg = _health(health)
    if journal is None:
        journal = {}
    if journal and journal.get("target") != target:
        raise RolloutError("journal_mismatch")
    journal["target"] = target
    journal.setdefault("previous", {})
    journal.setdefault("verified", [])

    batches = plan_batches(hosts, list(batch_sizes))
    res = {"status": "ok", "target": target, "batches": batches, "deployed": [],
           "rolled_back": [], "stuck": [], "failed_batch": None, "failed_host": None,
           "reason": None}
    started = None
    failure = None

    for idx, batch in enumerate(batches):
        if idx in journal["verified"]:
            continue
        if started is None:
            started = clock.now()
        for host in batch:
            current = fleet.version(host)
            if current == target:
                continue
            journal["previous"].setdefault(host, current)
            try:
                fleet.deploy(host, target)
            except Exception:
                failure = (idx, host, "deploy_error")
                break
            res["deployed"].append(host)
        if failure:
            break
        t0 = clock.now()
        streak = 0
        while True:
            clock.sleep(cfg["interval"])
            bad = [h for h in batch if not _safe_healthy(fleet, h)]
            streak = streak + 1 if not bad else 0
            if streak >= cfg["checks"]:
                journal["verified"].append(idx)
                break
            if clock.now() - t0 >= cfg["timeout"]:
                failure = (idx, bad[0] if bad else batch[0], "unhealthy")
                break
        if failure:
            break

    if failure:
        res["failed_batch"], res["failed_host"], res["reason"] = failure
        for host in reversed(list(journal["previous"])):
            prev = journal["previous"][host]
            try:
                if fleet.version(host) == prev:
                    del journal["previous"][host]
                    continue
                if prev is None:
                    fleet.remove(host)
                else:
                    fleet.deploy(host, prev)
            except Exception:
                res["stuck"].append(host)
                continue
            res["rolled_back"].append(host)
            del journal["previous"][host]
        if res["stuck"]:
            res["status"] = "rollback_failed"
        else:
            res["status"] = "rolled_back"
            journal["verified"].clear()

    res["elapsed"] = 0 if started is None else clock.now() - started
    return res


def _safe_healthy(fleet, host):
    try:
        return bool(fleet.healthy(host))
    except Exception:
        return False
