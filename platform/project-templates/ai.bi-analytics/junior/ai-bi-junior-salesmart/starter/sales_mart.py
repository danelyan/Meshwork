"""Витрина метрик продаж по контракту (contract.md)."""
import pandas as pd


def build_mart(orders: pd.DataFrame, items: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame:
    raise NotImplementedError("TODO")


def monthly_metrics(mart: pd.DataFrame) -> pd.DataFrame:
    raise NotImplementedError("TODO")


def category_share(mart: pd.DataFrame) -> pd.DataFrame:
    raise NotImplementedError("TODO")
