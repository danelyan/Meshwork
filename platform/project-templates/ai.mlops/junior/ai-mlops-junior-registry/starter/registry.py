"""Реестр моделей по контракту (contract.md)."""


class TransitionError(Exception):
    pass


class ModelRegistry:
    def __init__(self, path=None, clock=None):
        raise NotImplementedError("TODO")

    def register(self, name, metrics, params=None):
        raise NotImplementedError("TODO")

    def get(self, name, version):
        raise NotImplementedError("TODO")

    def list_versions(self, name, stage=None):
        raise NotImplementedError("TODO")

    def promote(self, name, version, stage):
        raise NotImplementedError("TODO")

    def production(self, name):
        raise NotImplementedError("TODO")

    def best(self, name, metric, higher_is_better=True, stages=None):
        raise NotImplementedError("TODO")
