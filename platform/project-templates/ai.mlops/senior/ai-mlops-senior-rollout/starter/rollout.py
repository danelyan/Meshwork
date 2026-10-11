"""Контроллер выкатки модели по контракту (contract.md)."""


def fingerprint(obj):
    raise NotImplementedError("TODO")


def bucket(seed, request_id):
    raise NotImplementedError("TODO")


class RolloutController:
    def __init__(self, production, policy, clock, seed=0):
        raise NotImplementedError("TODO")

    def start(self, candidate, data_hash=None):
        raise NotImplementedError("TODO")

    def route(self, request_id):
        raise NotImplementedError("TODO")

    def observe(self, version, metrics):
        raise NotImplementedError("TODO")

    def evaluate(self):
        raise NotImplementedError("TODO")

    def rollback(self, reason="manual"):
        raise NotImplementedError("TODO")

    def status(self):
        raise NotImplementedError("TODO")

    def history(self):
        raise NotImplementedError("TODO")
