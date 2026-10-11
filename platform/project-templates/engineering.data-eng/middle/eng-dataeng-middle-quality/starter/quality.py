"""Проверки качества данных с карантином по контракту (contract.md)."""
import pandas as pd


def check(orders: pd.DataFrame, customers: pd.DataFrame, max_amount: float = 1_000_000):
    raise NotImplementedError("TODO")


def run(orders_csv: str, customers_csv: str, out_dir: str) -> dict:
    raise NotImplementedError("TODO")
