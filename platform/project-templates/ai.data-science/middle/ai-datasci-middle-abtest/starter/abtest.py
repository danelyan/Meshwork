"""Анализ A/B-теста по контракту (contract.md)."""
import pandas as pd


def sample_size(baseline: float, mde: float, alpha: float = 0.05, power: float = 0.8) -> int:
    raise NotImplementedError("TODO")


def check_srm(n_control: int, n_treatment: int, expected_control_share: float = 0.5, alpha: float = 0.001) -> dict:
    raise NotImplementedError("TODO")


def analyze(df: pd.DataFrame, alpha: float = 0.05, srm_alpha: float = 0.001, winsor_q: float = 0.99) -> dict:
    raise NotImplementedError("TODO")
