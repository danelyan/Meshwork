"""Конвейер признаков и логистическая регрессия (эталон)."""
import numpy as np
import pandas as pd


def _check_df(df, cols):
    if not isinstance(df, pd.DataFrame):
        raise ValueError("df must be a DataFrame")
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"missing columns: {missing}")


class FeaturePipeline:
    def __init__(self, numeric, categorical=()):
        self.numeric, self.categorical = list(numeric), list(categorical)
        if not self.numeric and not self.categorical:
            raise ValueError("no columns")
        if set(self.numeric) & set(self.categorical):
            raise ValueError("column is both numeric and categorical")
        self._fitted = False

    def fit(self, df):
        _check_df(df, self.numeric + self.categorical)
        if len(df) == 0:
            raise ValueError("empty df")
        medians, mean, scale, cats = {}, {}, {}, {}
        for c in self.numeric:
            col = df[c].to_numpy(dtype="float64")
            if np.isnan(col).all():
                raise ValueError(f"column {c!r} is all NaN")
            med = float(np.nanmedian(col))
            filled = np.where(np.isnan(col), med, col)
            medians[c], mean[c] = med, float(filled.mean())
            scale[c] = 1.0 if np.ptp(filled) == 0 else float(filled.std())
        for c in self.categorical:
            cats[c] = sorted(df[c].dropna().unique().tolist())
        self.medians_, self.mean_, self.scale_, self.categories_ = medians, mean, scale, cats
        self.feature_names_ = list(self.numeric) + [f"{c}={v}" for c in self.categorical for v in cats[c]]
        self._fitted = True
        return self

    def transform(self, df):
        if not self._fitted:
            raise RuntimeError("pipeline is not fitted")
        _check_df(df, self.numeric + self.categorical)
        parts = []
        for c in self.numeric:
            col = df[c].to_numpy(dtype="float64")
            col = np.where(np.isnan(col), self.medians_[c], col)
            parts.append(((col - self.mean_[c]) / self.scale_[c]).reshape(-1, 1))
        for c in self.categorical:
            values = df[c].tolist()
            for cat in self.categories_[c]:
                parts.append(np.array([1.0 if v == cat else 0.0 for v in values], dtype="float64").reshape(len(values), 1))
        if not parts:
            return np.zeros((len(df), 0))
        return np.hstack(parts).astype("float64")

    def fit_transform(self, df):
        return self.fit(df).transform(df)


def _sigmoid(z):
    return 0.5 * (1.0 + np.tanh(z / 2.0))


class LogisticRegression:
    def __init__(self, lr=0.1, n_iter=500, l2=0.0):
        if lr <= 0 or n_iter < 1 or l2 < 0:
            raise ValueError("bad hyperparameters")
        self.lr, self.n_iter, self.l2 = lr, n_iter, l2
        self.coef_ = None
        self.intercept_ = 0.0

    def fit(self, X, y):
        X = np.asarray(X, dtype="float64")
        y = np.asarray(y)
        if X.ndim != 2 or X.shape[0] == 0 or X.shape[1] == 0:
            raise ValueError("X must be a non-empty 2D array")
        if not np.isfinite(X).all():
            raise ValueError("X has nan or inf")
        if y.shape != (X.shape[0],) or not np.isin(y, [0, 1]).all():
            raise ValueError("y must be 0/1 with len == n")
        y = y.astype("float64")
        if y.min() == y.max():
            raise ValueError("y has one class")
        n, d = X.shape
        w, b = np.zeros(d), 0.0
        for _ in range(self.n_iter):
            r = _sigmoid(X @ w + b) - y
            w = w - self.lr * (X.T @ r / n + self.l2 * w)
            b = b - self.lr * float(r.mean())
        self.coef_, self.intercept_ = w, float(b)
        return self

    def predict_proba(self, X):
        if self.coef_ is None:
            raise RuntimeError("model is not fitted")
        X = np.asarray(X, dtype="float64")
        if X.ndim != 2 or X.shape[1] != self.coef_.shape[0]:
            raise ValueError("bad X shape")
        return _sigmoid(X @ self.coef_ + self.intercept_)

    def predict(self, X, threshold=0.5):
        return (self.predict_proba(X) >= threshold).astype(int)


def train_and_evaluate(df, target, numeric, categorical=(), test_size=0.25, seed=0, **model_params):
    if not isinstance(df, pd.DataFrame) or target not in df.columns:
        raise ValueError("target not in df")
    if not (0 < test_size < 1):
        raise ValueError("test_size must be in (0, 1)")
    n = len(df)
    if n < 4:
        raise ValueError("need at least 4 rows")
    y = df[target].to_numpy()
    if not np.isin(y, [0, 1]).all():
        raise ValueError("target must be 0/1")
    y = y.astype(int)
    n_test = min(max(int(n * test_size + 0.5), 1), n - 1)
    perm = np.random.default_rng(seed).permutation(n)
    test_idx = sorted(int(i) for i in perm[:n_test])
    test_set = set(test_idx)
    train_idx = [i for i in range(n) if i not in test_set]
    train, test = df.iloc[train_idx], df.iloc[test_idx]
    pipe = FeaturePipeline(numeric, categorical).fit(train)
    model = LogisticRegression(**model_params).fit(pipe.transform(train), y[train_idx])
    y_pred = model.predict(pipe.transform(test))
    return {
        "train_idx": train_idx, "test_idx": test_idx,
        "feature_names": list(pipe.feature_names_), "mean": dict(pipe.mean_), "scale": dict(pipe.scale_),
        "coef": [float(v) for v in model.coef_], "intercept": float(model.intercept_),
        "y_pred": [int(v) for v in y_pred],
        "accuracy": float(np.mean(y_pred == y[test_idx])),
    }
