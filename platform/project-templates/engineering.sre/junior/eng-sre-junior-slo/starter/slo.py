"""SLI/SLO и бюджет ошибок по контракту (contract.md)."""


def is_good(event: dict) -> bool:
    raise NotImplementedError("TODO")


def availability(events: list, start: int, end: int):
    raise NotImplementedError("TODO")


def latency_sli(events: list, start: int, end: int, threshold_ms: float):
    raise NotImplementedError("TODO")


def percentile(values: list, p: float):
    raise NotImplementedError("TODO")


def window_report(events: list, start: int, end: int, window_s: int) -> list:
    raise NotImplementedError("TODO")


def error_budget(events: list, start: int, end: int, slo_target: float) -> dict:
    raise NotImplementedError("TODO")
