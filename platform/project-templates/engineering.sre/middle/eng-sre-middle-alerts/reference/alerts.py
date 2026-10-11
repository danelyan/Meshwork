"""Эталонное решение (кандидату не выдаётся): движок алертов по burn rate."""
import copy
import itertools
from collections import deque


def _validate(rule):
    if not isinstance(rule, dict):
        raise ValueError("rule must be dict")
    for k in ("name", "slo", "windows"):
        if k not in rule:
            raise ValueError(f"missing {k}")
    if not isinstance(rule["name"], str) or not rule["name"]:
        raise ValueError("bad name")
    slo = rule["slo"]
    if isinstance(slo, bool) or not isinstance(slo, (int, float)) or not 0 < slo < 1:
        raise ValueError("bad slo")
    if not isinstance(rule["windows"], list) or not rule["windows"]:
        raise ValueError("windows required")
    for w in rule["windows"]:
        if not isinstance(w, dict) or not all(k in w for k in ("long_s", "short_s", "burn")):
            raise ValueError("bad window")
        if not (0 < w["short_s"] < w["long_s"]) or w["burn"] <= 0:
            raise ValueError("bad window values")
    if rule.get("for_s", 0) < 0 or rule.get("keep_firing_for_s", 0) < 0:
        raise ValueError("negative duration")
    if rule.get("repeat_interval_s", 3600) <= 0:
        raise ValueError("bad repeat interval")


class _Alert:
    def __init__(self):
        self.state = "inactive"
        self.since = None
        self.false_since = None
        self.delivered = False
        self.last_sent = None
        self.resolved_pending = False


class AlertEngine:
    def __init__(self, rules, now, notify):
        names = set()
        self._rules = []
        for r in rules:
            _validate(r)
            if r["name"] in names:
                raise ValueError("duplicate name")
            names.add(r["name"])
            c = copy.deepcopy(r)
            c.setdefault("for_s", 0)
            c.setdefault("keep_firing_for_s", 0)
            c.setdefault("repeat_interval_s", 3600)
            c.setdefault("labels", {})
            self._rules.append(c)
        self._now = now
        self._notify = notify
        self._horizon = max((w["long_s"] for r in self._rules for w in r["windows"]), default=0)
        self._events = {}
        self._alerts = {}
        self._silences = {}
        self._ids = itertools.count(1)

    def record(self, service, ok):
        t = self._now()
        q = self._events.setdefault(service, deque())
        q.append((t, bool(ok)))
        while q and q[0][0] <= t - self._horizon:
            q.popleft()

    def _burn(self, rule, service, window, t):
        total = bad = 0
        for ts, ok in self._events.get(service, ()):
            if t - window < ts <= t:
                total += 1
                bad += 0 if ok else 1
        if not total:
            return 0
        return round((bad / total) / (1 - rule["slo"]), 9)

    def _cond(self, rule, service, t):
        return any(
            self._burn(rule, service, w["long_s"], t) >= w["burn"] and self._burn(rule, service, w["short_s"], t) >= w["burn"]
            for w in rule["windows"]
        )

    def _labels(self, rule, service):
        return {**rule["labels"], "alertname": rule["name"], "service": service}

    def _silenced(self, labels, t):
        for start, end, matchers in self._silences.values():
            if start <= t < end and all(labels.get(k) == v for k, v in matchers.items()):
                return True
        return False

    def _send(self, kind, rule, service, t):
        try:
            self._notify({"type": kind, "alertname": rule["name"], "labels": self._labels(rule, service), "at": t})
            return True
        except Exception:
            return False

    def evaluate(self):
        t = self._now()
        for rule in self._rules:
            for service in list(self._events):
                a = self._alerts.setdefault((rule["name"], service), _Alert())
                cond = self._cond(rule, service, t)
                if a.state in ("inactive", "resolved"):
                    if cond:
                        a.resolved_pending = False
                        a.state = "firing" if rule["for_s"] == 0 else "pending"
                        a.since = t
                        a.false_since = None
                        if a.state == "firing":
                            a.delivered = False
                            a.last_sent = None
                elif a.state == "pending":
                    if not cond:
                        a.state, a.since = "inactive", None
                    elif t - a.since >= rule["for_s"]:
                        a.state, a.since = "firing", t
                        a.delivered, a.last_sent = False, None
                elif a.state == "firing":
                    if cond:
                        a.false_since = None
                    else:
                        if a.false_since is None:
                            a.false_since = t
                        if t - a.false_since >= rule["keep_firing_for_s"]:
                            a.state, a.since = "resolved", t
                            a.resolved_pending = a.delivered
                            a.delivered, a.last_sent = False, None
                            a.false_since = None
                labels = self._labels(rule, service)
                silenced = self._silenced(labels, t)
                if a.state == "firing" and not silenced:
                    due = not a.delivered or t - a.last_sent >= rule["repeat_interval_s"]
                    if due and self._send("firing", rule, service, t):
                        a.delivered, a.last_sent = True, t
                elif a.state == "resolved" and a.resolved_pending:
                    if silenced:
                        a.resolved_pending = False
                    elif self._send("resolved", rule, service, t):
                        a.resolved_pending = False

    def state(self, alertname, service):
        a = self._alerts.get((alertname, service))
        return a.state if a else "inactive"

    def alerts(self):
        t = self._now()
        out = []
        for rule in self._rules:
            for (name, service), a in self._alerts.items():
                if name == rule["name"] and a.state in ("pending", "firing"):
                    labels = self._labels(rule, service)
                    out.append({"alertname": name, "service": service, "labels": labels, "state": a.state,
                                "since": a.since, "silenced": self._silenced(labels, t)})
        return sorted(out, key=lambda d: (d["alertname"], d["service"]))

    def add_silence(self, matchers, duration_s):
        if not matchers or duration_s <= 0:
            raise ValueError("bad silence")
        sid = f"sil-{next(self._ids)}"
        t = self._now()
        self._silences[sid] = (t, t + duration_s, dict(matchers))
        return sid

    def remove_silence(self, silence_id):
        return self._silences.pop(silence_id, None) is not None
