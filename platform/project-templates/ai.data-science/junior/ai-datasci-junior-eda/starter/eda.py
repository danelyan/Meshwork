"""Очистка таблицы пользователей и сводка по контракту (contract.md)."""
import pandas as pd


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    raise NotImplementedError("TODO")


def summarize(clean_df: pd.DataFrame) -> pd.DataFrame:
    raise NotImplementedError("TODO")
