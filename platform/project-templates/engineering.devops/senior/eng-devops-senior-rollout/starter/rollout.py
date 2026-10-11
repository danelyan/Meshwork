"""Оркестратор поэтапной выкатки по контракту (contract.md)."""


class RolloutError(ValueError):
    def __init__(self, code, message=""):
        super().__init__(message or code)
        self.code = code


def plan_batches(hosts, sizes):
    raise NotImplementedError("TODO")


def rollout(hosts, target, fleet, clock, batch_sizes=(1,), health=None, journal=None):
    raise NotImplementedError("TODO")
