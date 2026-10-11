# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import numpy as np
import pandas as pd
import pytest

from mlpipe import FeaturePipeline, LogisticRegression, train_and_evaluate


def test_standardize_with_train_stats_and_nan_median():
    train = pd.DataFrame({"x": [1.0, 2.0, 3.0, np.nan]})  # медиана 2.0, после замены [1, 2, 3, 2]
    p = FeaturePipeline(["x"]).fit(train)
    assert p.medians_["x"] == pytest.approx(2.0) and p.mean_["x"] == pytest.approx(2.0)
    out = p.transform(pd.DataFrame({"x": [4.0, np.nan]}))
    s = float(np.std([1, 2, 3, 2]))
    assert out.shape == (2, 1) and out[0, 0] == pytest.approx(2.0 / s) and out[1, 0] == pytest.approx(0.0)


def test_one_hot_unseen_is_zeros():
    p = FeaturePipeline(["x"], ["c"]).fit(pd.DataFrame({"x": [1.0, 2.0], "c": ["b", "a"]}))
    assert p.feature_names_ == ["x", "c=a", "c=b"]
    out = p.transform(pd.DataFrame({"x": [1.0, 1.0], "c": ["a", "zzz"]}))
    assert out[:, 1:].tolist() == [[1.0, 0.0], [0.0, 0.0]]


def test_logreg_first_step_and_split_is_disjoint():
    X = np.array([[1.0], [-1.0], [2.0], [-2.0]])
    y = np.array([1, 0, 1, 0])
    m = LogisticRegression(lr=1.0, n_iter=1).fit(X, y)
    assert m.coef_[0] == pytest.approx(0.75) and m.intercept_ == pytest.approx(0.0)
    df = pd.DataFrame({"x": np.arange(12.0), "y": [0, 1] * 6})
    r = train_and_evaluate(df, "y", ["x"], test_size=0.25, seed=1)
    assert len(r["test_idx"]) == 3 and not set(r["train_idx"]) & set(r["test_idx"])
