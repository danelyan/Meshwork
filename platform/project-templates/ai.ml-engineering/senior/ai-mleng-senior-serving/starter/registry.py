"""Реестр версий модели и пакетный инференс по контракту (contract.md)."""


class ModelRegistry:
    def register(self, version, model):
        raise NotImplementedError("TODO")

    def activate(self, version, allow_schema_change=False):
        raise NotImplementedError("TODO")

    def rollback(self):
        raise NotImplementedError("TODO")

    def active_version(self):
        raise NotImplementedError("TODO")

    def versions(self):
        raise NotImplementedError("TODO")

    def get_model(self, version):
        raise NotImplementedError("TODO")

    def predict_batch(self, rows, version=None):
        raise NotImplementedError("TODO")

    def export_state(self):
        raise NotImplementedError("TODO")

    @classmethod
    def from_state(cls, state):
        raise NotImplementedError("TODO")
