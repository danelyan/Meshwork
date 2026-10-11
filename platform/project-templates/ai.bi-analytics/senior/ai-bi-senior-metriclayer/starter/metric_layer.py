"""Слой метрик по контракту (contract.md)."""
import pandas as pd


class MetricLayer:
    def __init__(self, definitions: dict, tables: dict) -> None:
        raise NotImplementedError("TODO")

    def query(self, metric: str, by=(), filters: dict | None = None) -> pd.DataFrame:
        raise NotImplementedError("TODO")

    def reconcile(self, metric: str, by) -> dict:
        raise NotImplementedError("TODO")


def find_duplicates(definitions: dict) -> list[list[str]]:
    raise NotImplementedError("TODO")


def plan_vs_fact(layer: MetricLayer, plan: pd.DataFrame, metric: str, by=("month",), tolerance: float = 0.05) -> pd.DataFrame:
    raise NotImplementedError("TODO")
