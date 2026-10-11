"""Когорты, LTV и CUPED по контракту (contract.md)."""
import pandas as pd


def build_cohorts(users: pd.DataFrame, orders: pd.DataFrame, as_of: str, horizon: int = 3) -> pd.DataFrame:
    raise NotImplementedError("TODO")


def cuped_adjust(y, x) -> dict:
    raise NotImplementedError("TODO")


def ab_ltv(users: pd.DataFrame, orders: pd.DataFrame, exp_start: str,
           pre_days: int = 30, post_days: int = 30, alpha: float = 0.05) -> dict:
    raise NotImplementedError("TODO")
