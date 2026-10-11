"""Retention и воронка с проверками качества данных по контракту (contract.md)."""
import pandas as pd


def check_events(events: pd.DataFrame, as_of: str) -> tuple[pd.DataFrame, dict]:
    raise NotImplementedError("TODO")


def weekly_retention(events: pd.DataFrame, as_of: str, weeks: int = 4) -> pd.DataFrame:
    raise NotImplementedError("TODO")


def funnel(events: pd.DataFrame, as_of: str, steps=("signup", "activate", "purchase"), window_days: int = 7) -> pd.DataFrame:
    raise NotImplementedError("TODO")
