"""Эталонное решение (кандидату не выдаётся): SLI/SLO и бюджет ошибок."""
import math


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check(events: list) -> None:
    for e in events:
        if not isinstance(e, dict) or not all(k in e for k in ("ts", "status", "latency_ms")):
            raise ValueError("bad event")
        if isinstance(e["ts"], bool) or not isinstance(e["ts"], int):
            raise ValueError("bad ts")
        if isinstance(e["status"], bool) or not isinstance(e["status"], int):
            raise ValueError("bad status")
        if not _num(e["latency_ms"]) or e["latency_ms"] < 0:
            raise ValueError("bad latency")


def _select(events: list, start: int, end: int) -> list:
    _check(events)
    if end <= start:
        raise ValueError("end must be greater than start")
    return [e for e in events if start <= e["ts"] < end]


def is_good(event: dict) -> bool:
    return event["status"] < 500


def availability(events: list, start: int, end: int):
    sel = _select(events, start, end)
    if not sel:
        return None
    return sum(1 for e in sel if is_good(e)) / len(sel)


def latency_sli(events: list, start: int, end: int, threshold_ms: float):
    if threshold_ms <= 0:
        raise ValueError("threshold must be positive")
    sel = _select(events, start, end)
    if not sel:
        return None
    return sum(1 for e in sel if e["latency_ms"] <= threshold_ms) / len(sel)


def percentile(values: list, p: float):
    if not (0 < p <= 100):
        raise ValueError("p must be in (0, 100]")
    if not values:
        return None
    s = sorted(values)
    rank = math.ceil(p / 100 * len(s))
    return s[max(rank, 1) - 1]


def window_report(events: list, start: int, end: int, window_s: int) -> list:
    sel = _select(events, start, end)
    if window_s <= 0 or (end - start) % window_s != 0:
        raise ValueError("bad window")
    out = []
    for ws in range(start, end, window_s):
        part = [e for e in sel if ws <= e["ts"] < ws + window_s]
        lat = [e["latency_ms"] for e in part]
        good = sum(1 for e in part if is_good(e))
        out.append({
            "start": ws,
            "end": ws + window_s,
            "total": len(part),
            "good": good,
            "availability": good / len(part) if part else None,
            "p95": percentile(lat, 95),
            "p99": percentile(lat, 99),
        })
    return out


def error_budget(events: list, start: int, end: int, slo_target: float) -> dict:
    if not (0 < slo_target < 1):
        raise ValueError("slo_target must be between 0 and 1")
    sel = _select(events, start, end)
    total = len(sel)
    bad = sum(1 for e in sel if not is_good(e))
    allowed = round(total * (1 - slo_target), 9)
    return {
        "total": total,
        "bad": bad,
        "allowed_bad": allowed,
        "remaining": round(allowed - bad, 9),
        "consumed_ratio": bad / allowed if total and allowed else (None if not total else (0.0 if bad == 0 else math.inf)),
        "exhausted": bool(total) and bad > allowed,
    }
