"""Конвейер признаков и логистическая регрессия по контракту (contract.md)."""
import numpy as np
import pandas as pd


class FeaturePipeline:
    def __init__(self, numeric, categorical=()):
        raise NotImplementedError("TODO")

    def fit(self, df):
        raise NotImplementedError("TODO")

    def transform(self, df):
        raise NotImplementedError("TODO")

    def fit_transform(self, df):
        raise NotImplementedError("TODO")


class LogisticRegression:
    def __init__(self, lr=0.1, n_iter=500, l2=0.0):
        raise NotImplementedError("TODO")

    def fit(self, X, y):
        raise NotImplementedError("TODO")

    def predict_proba(self, X):
        raise NotImplementedError("TODO")

    def predict(self, X, threshold=0.5):
        raise NotImplementedError("TODO")


def train_and_evaluate(df, target, numeric, categorical=(), test_size=0.25, seed=0, **model_params):
    raise NotImplementedError("TODO")
