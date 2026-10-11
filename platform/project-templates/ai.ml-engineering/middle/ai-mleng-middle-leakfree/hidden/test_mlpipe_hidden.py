# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import warnings

import numpy as np
import pandas as pd
import pytest

from mlpipe import FeaturePipeline, LogisticRegression, train_and_evaluate

TRAIN = pd.DataFrame({
    "age": [20.0, 30.0, np.nan, 40.0, 50.0],
    "inc": [1.0, 1.0, 1.0, 1.0, 1.0],
    "city": ["msk", "spb", "msk", None, "kzn"],
})


def test_constructor_validation():
    for args in (([], []), (["a"], ["a"]), ([], ())):
        with pytest.raises(ValueError):
            FeaturePipeline(*args)


def test_fit_statistics_on_train_only():
    p = FeaturePipeline(["age", "inc"], ["city"]).fit(TRAIN)
    filled = np.array([20.0, 30.0, 35.0, 40.0, 50.0])  # медиана непропущенных = 35
    assert p.medians_["age"] == pytest.approx(35.0)
    assert p.mean_["age"] == pytest.approx(filled.mean()) and p.scale_["age"] == pytest.approx(filled.std())
    assert p.categories_ == {"city": ["kzn", "msk", "spb"]}
    assert p.feature_names_ == ["age", "inc", "city=kzn", "city=msk", "city=spb"]


def test_train_output_is_standardized():
    p = FeaturePipeline(["age"]).fit(TRAIN)
    out = p.transform(TRAIN)
    assert out.dtype == np.float64 and out.shape == (5, 1)
    assert out.mean() == pytest.approx(0.0, abs=1e-12) and out.std() == pytest.approx(1.0)
    const = FeaturePipeline(["inc"]).fit(TRAIN)
    assert const.scale_["inc"] == 1.0 and np.allclose(const.transform(TRAIN), 0.0)
    full = FeaturePipeline(["age"], ["city"])
    assert np.array_equal(full.fit_transform(TRAIN), FeaturePipeline(["age"], ["city"]).fit(TRAIN).transform(TRAIN))


def test_transform_uses_train_stats_not_own():
    p = FeaturePipeline(["age"], ["city"]).fit(TRAIN)
    test = pd.DataFrame({"age": [1000.0, np.nan], "city": ["spb", "unknown"]})
    out = p.transform(test)
    m, s = p.mean_["age"], p.scale_["age"]
    assert out[0, 0] == pytest.approx((1000.0 - m) / s)
    assert out[1, 0] == pytest.approx((35.0 - m) / s)  # NaN -> медиана train
    assert out[:, 1:].tolist() == [[0.0, 0.0, 1.0], [0.0, 0.0, 0.0]]
    nulls = p.transform(pd.DataFrame({"age": [30.0, 30.0], "city": [None, np.nan]}))
    assert nulls[:, 1:].sum() == 0.0


def test_transform_has_no_side_effects():
    p = FeaturePipeline(["age"], ["city"]).fit(TRAIN)
    before = (dict(p.mean_), dict(p.scale_), dict(p.medians_), {k: list(v) for k, v in p.categories_.items()}, list(p.feature_names_))
    t = pd.DataFrame({"age": [1e9, np.nan], "city": ["new", "msk"]})
    snapshot = t.copy()
    p.transform(t)
    pd.testing.assert_frame_equal(t, snapshot)
    after = (dict(p.mean_), dict(p.scale_), dict(p.medians_), {k: list(v) for k, v in p.categories_.items()}, list(p.feature_names_))
    assert before == after


def test_pipeline_errors_and_refit():
    p = FeaturePipeline(["age"])
    with pytest.raises(RuntimeError):
        p.transform(TRAIN)
    with pytest.raises(ValueError):
        p.fit(TRAIN[["inc"]])
    with pytest.raises(ValueError):
        p.fit(TRAIN.iloc[0:0])
    with pytest.raises(ValueError):
        p.fit([1, 2, 3])
    with pytest.raises(ValueError):
        p.fit(pd.DataFrame({"age": [np.nan, np.nan]}))
    p.fit(TRAIN)
    with pytest.raises(ValueError):
        p.transform(TRAIN[["inc"]])
    assert p.transform(TRAIN.iloc[0:0]).shape == (0, 1)
    p.fit(pd.DataFrame({"age": [0.0, 10.0]}))
    assert p.mean_["age"] == pytest.approx(5.0)


def test_logreg_exact_steps_with_l2():
    X = np.array([[1.0, 0.0], [-1.0, 1.0], [2.0, -1.0], [-2.0, 0.5]])
    y = np.array([1, 0, 1, 0])
    lr, l2 = 0.5, 0.2
    w, b = np.zeros(2), 0.0
    for _ in range(3):
        p = 1 / (1 + np.exp(-(X @ w + b)))
        w = w - lr * (X.T @ (p - y) / 4 + l2 * w)
        b = b - lr * np.mean(p - y)
    m = LogisticRegression(lr=lr, n_iter=3, l2=l2).fit(X, y)
    assert np.allclose(m.coef_, w) and m.intercept_ == pytest.approx(b)


def test_logreg_learns_separable_and_predict_threshold():
    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 2))
    y = (X[:, 0] + 0.5 * X[:, 1] > 0).astype(int)
    m = LogisticRegression().fit(X, y)
    proba = m.predict_proba(X)
    assert proba.shape == (200,) and ((proba > 0) & (proba < 1)).all()
    assert (m.predict(X) == y).mean() > 0.97
    assert m.predict(X).dtype.kind == "i"
    assert m.predict(X, threshold=0.999).sum() < m.predict(X).sum()
    assert m.coef_[0] > m.coef_[1] > 0
    mb = LogisticRegression().fit(X, y.astype(bool))
    assert np.allclose(mb.coef_, m.coef_)


def test_logreg_sigmoid_is_stable():
    m = LogisticRegression(n_iter=5).fit(np.array([[1.0], [-1.0]]), np.array([1, 0]))
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        p = m.predict_proba(np.array([[1e6], [-1e6], [1e300]]))
    assert p.tolist() == [1.0, 0.0, 1.0] or (p[0] > 0.999 and p[1] < 0.001 and not np.isnan(p).any())


def test_logreg_validation():
    X = np.array([[1.0], [-1.0], [2.0]])
    for kw in ({"lr": 0}, {"lr": -1}, {"n_iter": 0}, {"l2": -0.1}):
        with pytest.raises(ValueError):
            LogisticRegression(**kw)
    bad = [
        (np.array([1.0, 2.0, 3.0]), np.array([0, 1, 0])),
        (np.empty((0, 1)), np.array([])),
        (X, np.array([0, 1])),
        (X, np.array([0, 1, 2])),
        (X, np.array([1, 1, 1])),
        (np.array([[1.0], [np.nan], [2.0]]), np.array([0, 1, 0])),
        (np.array([[1.0], [np.inf], [2.0]]), np.array([0, 1, 0])),
    ]
    for Xb, yb in bad:
        with pytest.raises(ValueError):
            LogisticRegression().fit(Xb, yb)
    with pytest.raises(RuntimeError):
        LogisticRegression().predict_proba(X)
    with pytest.raises(RuntimeError):
        LogisticRegression().predict(X)
    m = LogisticRegression(n_iter=2).fit(X, np.array([1, 0, 1]))
    with pytest.raises(ValueError):
        m.predict_proba(np.ones((2, 3)))


def make_df(n=80, seed=3):
    rng = np.random.default_rng(seed)
    x1, x2 = rng.normal(size=n), rng.normal(size=n)
    city = rng.choice(["a", "b", "c"], size=n)
    y = ((x1 + 0.8 * x2 + (city == "a") * 1.5) > 0.5).astype(int)
    x2 = np.where(rng.random(n) < 0.1, np.nan, x2)
    return pd.DataFrame({"x1": x1, "x2": x2, "city": city, "y": y})


def test_split_sizes_cover_and_determinism():
    df = make_df(40)
    r = train_and_evaluate(df, "y", ["x1", "x2"], ["city"], test_size=0.3, seed=7)
    assert len(r["test_idx"]) == 12 and len(r["train_idx"]) == 28
    assert sorted(r["train_idx"] + r["test_idx"]) == list(range(40))
    assert r["train_idx"] == sorted(r["train_idx"]) and r["test_idx"] == sorted(r["test_idx"])
    assert train_and_evaluate(df, "y", ["x1", "x2"], ["city"], test_size=0.3, seed=7) == r
    tests = {tuple(train_and_evaluate(df, "y", ["x1"], test_size=0.3, seed=s)["test_idx"]) for s in range(5)}
    assert len(tests) > 1


def test_split_bounds_and_positional_rows():
    df = make_df(10)
    assert len(train_and_evaluate(df, "y", ["x1"], test_size=0.01)["test_idx"]) == 1
    with pytest.raises(ValueError):  # в train остаётся одна строка – один класс
        train_and_evaluate(df, "y", ["x1"], test_size=0.99)
    shuffled = df.iloc[::-1].copy()
    shuffled.index = [100 + i * 7 for i in range(10)]  # метки индекса не совпадают с позициями
    a = train_and_evaluate(df, "y", ["x1", "x2"], ["city"], seed=2)
    b = train_and_evaluate(shuffled.iloc[::-1].set_axis(range(1000, 1010)), "y", ["x1", "x2"], ["city"], seed=2)
    assert a == b


def test_no_leakage_from_test_rows():
    df = make_df(60)
    base = train_and_evaluate(df, "y", ["x1", "x2"], ["city"], seed=5)
    poisoned = df.copy()
    ti = base["test_idx"]
    poisoned.iloc[ti, poisoned.columns.get_loc("x1")] = 1e6
    poisoned.iloc[ti, poisoned.columns.get_loc("x2")] = -1e6
    poisoned.iloc[ti, poisoned.columns.get_loc("city")] = "zzz"
    r = train_and_evaluate(poisoned, "y", ["x1", "x2"], ["city"], seed=5)
    for key in ("train_idx", "test_idx", "feature_names", "mean", "scale", "coef", "intercept"):
        assert r[key] == base[key], key
    changed = df.copy()
    changed.iloc[base["train_idx"][0], changed.columns.get_loc("x1")] += 100.0
    assert train_and_evaluate(changed, "y", ["x1", "x2"], ["city"], seed=5)["mean"] != base["mean"]


def test_mean_scale_are_train_statistics():
    df = make_df(60)
    r = train_and_evaluate(df, "y", ["x1", "x2"], ["city"], seed=1)
    tr = df.iloc[r["train_idx"]]
    x2 = tr["x2"].fillna(tr["x2"].median())
    assert r["mean"]["x2"] == pytest.approx(x2.mean()) and r["scale"]["x2"] == pytest.approx(x2.std(ddof=0))
    assert r["feature_names"] == ["x1", "x2", "city=a", "city=b", "city=c"]
    assert len(r["coef"]) == 5 and len(r["y_pred"]) == len(r["test_idx"])


def test_end_to_end_quality_and_accuracy_value():
    df = make_df(200, seed=11)
    r = train_and_evaluate(df, "y", ["x1", "x2"], ["city"], seed=0, n_iter=800)
    y_test = df["y"].to_numpy()[r["test_idx"]]
    assert r["accuracy"] == pytest.approx(float(np.mean(np.array(r["y_pred"]) == y_test)))
    assert r["accuracy"] > 0.85
    assert all(isinstance(v, int) for v in r["y_pred"]) and isinstance(r["accuracy"], float)


def test_model_params_are_passed_and_global_rng_untouched():
    df = make_df(60)
    a = train_and_evaluate(df, "y", ["x1"], seed=0, n_iter=1)
    b = train_and_evaluate(df, "y", ["x1"], seed=0, n_iter=300)
    assert a["coef"] != b["coef"]
    np.random.seed(9)
    state = np.random.get_state()[1].copy()
    train_and_evaluate(df, "y", ["x1"], seed=0)
    assert np.array_equal(np.random.get_state()[1], state)


def test_train_and_evaluate_validation_and_no_mutation():
    df = make_df(20)
    snap = df.copy()
    train_and_evaluate(df, "y", ["x1"], ["city"])
    pd.testing.assert_frame_equal(df, snap)
    with pytest.raises(ValueError):
        train_and_evaluate(df, "nope", ["x1"])
    with pytest.raises(ValueError):
        train_and_evaluate(df.assign(y=df["y"] * 2), "y", ["x1"])
    for bad in (0, 1, -0.5, 2):
        with pytest.raises(ValueError):
            train_and_evaluate(df, "y", ["x1"], test_size=bad)
    with pytest.raises(ValueError):
        train_and_evaluate(df.iloc[:3], "y", ["x1"])
    with pytest.raises(ValueError):
        train_and_evaluate(df.assign(y=0), "y", ["x1"])
