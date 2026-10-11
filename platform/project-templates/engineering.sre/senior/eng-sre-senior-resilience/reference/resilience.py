"""Эталон: circuit breaker + ретраи с бюджетом + load shedding на инъецированных часах."""
import math
from collections import deque


class TransientError(Exception):
    pass


class Rejected(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


_DEFAULTS = {
    "failure_threshold": 5, "failure_window_s": 10, "cooldown_s": 30, "half_open_successes": 2,
    "max_attempts": 3, "backoff_s": 0.1, "max_backoff_s": 2, "retry_ratio": 0.2, "retry_min": 1,
    "budget_window_s": 10, "capacity": 100, "shed_window_s": 1,
}
_SHARE = {"critical": 1.0, "normal": 0.8, "low": 0.5}


class ResilientClient:
    def __init__(self, upstream, now, sleep, **config):
        unknown = set(config) - set(_DEFAULTS)
        if unknown:
            raise ValueError(f"unknown config {sorted(unknown)}")
        c = {**_DEFAULTS, **config}
        for k, v in c.items():
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError(k)
            if k in ("retry_ratio", "retry_min"):
                if v < 0:
                    raise ValueError(k)
            elif v <= 0:
                raise ValueError(k)
        self._c = c
        self._up, self._now, self._sleep = upstream, now, sleep
        self._failures = deque()
        self._state = "closed"
        self._opened_at = None
        self._streak = 0
        self._admitted = deque()
        self._retries = deque()
        self._stats = {"calls": 0, "shed": 0, "short_circuited": 0, "upstream_calls": 0, "retries": 0, "retries_denied": 0}

    @staticmethod
    def _trim(q, t, w):
        while q and q[0] <= t - w:
            q.popleft()

    @staticmethod
    def _count(q, t, w):
        return sum(1 for ts in q if t - w < ts <= t)

    def _refresh(self):
        if self._state == "open" and self._now() >= self._opened_at + self._c["cooldown_s"]:
            self._state, self._streak = "half_open", 0

    def _open(self, t):
        self._state, self._opened_at, self._streak = "open", t, 0
        self._failures.clear()

    def state(self):
        self._refresh()
        return self._state

    def stats(self):
        return dict(self._stats)

    def _record(self, ok):
        t = self._now()
        if ok:
            if self._state == "half_open":
                self._streak += 1
                if self._streak >= self._c["half_open_successes"]:
                    self._state, self._streak = "closed", 0
                    self._failures.clear()
            return
        if self._state == "half_open":
            self._open(t)
        elif self._state == "closed":
            self._failures.append(t)
            self._trim(self._failures, t, self._c["failure_window_s"])
            if len(self._failures) >= self._c["failure_threshold"]:
                self._open(t)

    def call(self, request, priority="normal"):
        if priority not in _SHARE:
            raise ValueError("bad priority")
        c = self._c
        self._stats["calls"] += 1
        if self.state() == "open":
            self._stats["short_circuited"] += 1
            raise Rejected("breaker_open")
        t = self._now()
        self._trim(self._admitted, t, max(c["shed_window_s"], c["budget_window_s"]))
        if self._count(self._admitted, t, c["shed_window_s"]) >= math.floor(c["capacity"] * _SHARE[priority]):
            self._stats["shed"] += 1
            raise Rejected("shed")
        self._admitted.append(t)
        attempt = 0
        while True:
            attempt += 1
            self._stats["upstream_calls"] += 1
            try:
                result = self._up(request)
            except TransientError as e:
                err = e
                self._record(False)
            except Exception:
                self._record(True)
                raise
            else:
                self._record(True)
                return result
            # TransientError: решаем о повторе (последняя ошибка пробрасывается)
            if attempt >= c["max_attempts"]:
                raise err
            if self.state() == "open":
                self._stats["short_circuited"] += 1
                raise Rejected("breaker_open")
            t = self._now()
            self._trim(self._retries, t, c["budget_window_s"])
            n = self._count(self._admitted, t, c["budget_window_s"])
            if len(self._retries) >= math.floor(c["retry_ratio"] * n) + c["retry_min"]:
                self._stats["retries_denied"] += 1
                raise err
            self._retries.append(t)
            self._stats["retries"] += 1
            self._sleep(min(c["backoff_s"] * 2 ** (attempt - 1), c["max_backoff_s"]))
