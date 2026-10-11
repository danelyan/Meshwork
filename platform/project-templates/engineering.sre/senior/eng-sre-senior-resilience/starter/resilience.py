"""Клиент к нестабильной зависимости по контракту (contract.md)."""


class TransientError(Exception):
    pass


class Rejected(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class ResilientClient:
    def __init__(self, upstream, now, sleep, **config):
        raise NotImplementedError("TODO")

    def call(self, request, priority="normal"):
        raise NotImplementedError("TODO")

    def state(self):
        raise NotImplementedError("TODO")

    def stats(self):
        raise NotImplementedError("TODO")
