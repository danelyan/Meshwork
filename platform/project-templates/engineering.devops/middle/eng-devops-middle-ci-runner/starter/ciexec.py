"""Исполнитель CI-пайплайна по контракту (contract.md)."""


class PipelineError(ValueError):
    def __init__(self, code, details=None, message=""):
        super().__init__(message or code)
        self.code = code
        self.details = details if details is not None else []


def plan(pipeline: dict) -> list:
    raise NotImplementedError("TODO")


def run(pipeline: dict, executor, files=None, cache=None, max_parallel: int = 1) -> dict:
    raise NotImplementedError("TODO")
