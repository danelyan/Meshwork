# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pytest

from registry import ModelRegistry

M1 = {"features": ["a", "b"], "weights": [1.0, -1.0], "bias": 0.0}
M2 = {"features": ["b", "a"], "weights": [2.0, 1.0], "bias": 0.5, "threshold": 0.6}


def test_register_activate_predict():
    r = ModelRegistry()
    r.register("v1", M1)
    assert r.active_version() is None
    r.activate("v1")
    out = r.predict_batch([{"a": 2, "b": 0}, {"a": 0, "b": 2}])
    assert out["version"] == "v1" and (out["n_ok"], out["n_failed"]) == (2, 0)
    assert out["results"][0]["label"] == 1 and out["results"][1]["label"] == 0
    assert out["results"][0]["score"] == pytest.approx(0.8807970779778823)


def test_row_errors_do_not_break_batch():
    r = ModelRegistry()
    r.register("v1", M1)
    r.activate("v1")
    out = r.predict_batch([{"a": 1}, {"a": 1, "b": 0}, "x"])
    assert [x.get("error") for x in out["results"]] == ["missing_feature:b", None, "not_a_dict"]
    assert (out["n_ok"], out["n_failed"]) == (1, 2)


def test_activate_rollback():
    r = ModelRegistry()
    r.register("v1", M1)
    r.register("v2", M2)
    r.activate("v1")
    r.activate("v2")
    assert r.active_version() == "v2"
    assert r.rollback() == "v1"
    with pytest.raises(LookupError):
        r.rollback()
