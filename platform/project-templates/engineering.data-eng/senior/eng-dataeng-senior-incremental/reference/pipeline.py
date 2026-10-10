"""Эталон: проверка, дедупликация с окном памяти, водяной знак по прошлым пачкам, дневные агрегаты."""
import copy
from datetime import datetime, timedelta, timezone

FIELDS = ("event_id", "user_id", "kind", "amount_kop", "event_time")


def _empty():
    return {"version": 1, "max_time": None, "seen": {}, "daily": {}, "late": 0, "duplicates": 0, "rejected": {}}


def _parse_time(v):
    if not isinstance(v, str):
        return None
    try:
        t = datetime.fromisoformat(v)
    except ValueError:
        return None
    if t.tzinfo is None:
        return None
    return t.astimezone(timezone.utc)


def _reason(e):
    if not isinstance(e, dict) or any(f not in e for f in FIELDS):
        return "missing_field", None
    if not isinstance(e["event_id"], str) or not e["event_id"] or not isinstance(e["user_id"], str) or not e["user_id"]:
        return "bad_type", None
    if e["kind"] not in ("purchase", "refund"):
        return "bad_kind", None
    a = e["amount_kop"]
    if isinstance(a, bool) or not isinstance(a, int) or a < 0:
        return "bad_amount", None
    t = _parse_time(e["event_time"])
    if t is None:
        return "bad_time", None
    return None, t


def _watermark(state, lateness):
    if state["max_time"] is None:
        return None
    return datetime.fromisoformat(state["max_time"]) - lateness


def process_batch(state, events, allowed_lateness=timedelta(hours=2)):
    s = copy.deepcopy(state) if state is not None else _empty()
    wm = _watermark(s, allowed_lateness)
    max_time = datetime.fromisoformat(s["max_time"]) if s["max_time"] else None
    for e in events:
        reason, t = _reason(e)
        if reason:
            s["rejected"][reason] = s["rejected"].get(reason, 0) + 1
            continue
        if wm is not None and t < wm:
            s["late"] += 1
            continue
        if e["event_id"] in s["seen"]:
            s["duplicates"] += 1
            continue
        s["seen"][e["event_id"]] = t.isoformat()
        key = f'{t.date().isoformat()}|{e["user_id"]}'
        d = s["daily"].setdefault(key, {"date": t.date().isoformat(), "user_id": e["user_id"], "purchases_kop": 0, "refunds_kop": 0, "net_kop": 0, "events": 0})
        if e["kind"] == "purchase":
            d["purchases_kop"] += e["amount_kop"]
            d["net_kop"] += e["amount_kop"]
        else:
            d["refunds_kop"] += e["amount_kop"]
            d["net_kop"] -= e["amount_kop"]
        d["events"] += 1
        if max_time is None or t > max_time:
            max_time = t
    s["max_time"] = max_time.isoformat() if max_time else None
    new_wm = _watermark(s, allowed_lateness)
    if new_wm is not None:
        s["seen"] = {k: v for k, v in s["seen"].items() if datetime.fromisoformat(v) >= new_wm}
    s["lateness_sec"] = allowed_lateness.total_seconds()
    return s


def report(state):
    lateness = timedelta(seconds=state.get("lateness_sec", 7200))
    wm = _watermark(state, lateness)
    days = sorted(state["daily"].values(), key=lambda d: (d["date"], d["user_id"]))
    return {
        "days": [dict(d) for d in days],
        "late": state["late"],
        "duplicates": state["duplicates"],
        "rejected": dict(state["rejected"]),
        "watermark": wm.isoformat() if wm else None,
    }


def seen_count(state):
    return len(state["seen"])
