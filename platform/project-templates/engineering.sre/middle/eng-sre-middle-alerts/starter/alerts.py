"""Движок алертов по burn rate (contract.md)."""


class AlertEngine:
    def __init__(self, rules, now, notify):
        raise NotImplementedError("TODO")

    def record(self, service, ok):
        raise NotImplementedError("TODO")

    def evaluate(self):
        raise NotImplementedError("TODO")

    def state(self, alertname, service):
        raise NotImplementedError("TODO")

    def alerts(self):
        raise NotImplementedError("TODO")

    def add_silence(self, matchers, duration_s):
        raise NotImplementedError("TODO")

    def remove_silence(self, silence_id):
        raise NotImplementedError("TODO")
