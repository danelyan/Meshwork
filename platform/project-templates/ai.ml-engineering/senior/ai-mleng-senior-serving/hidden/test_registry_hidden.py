# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import copy
import json
import math
import os
import re

import pytest

import registry
from registry import ModelRegistry

M1 = {"features": ["a", "b"], "weights": [1.0, -1.0], "bias": 0.0}
M2 = {"features": ["b", "a"], "weights": [2.0, 1.0], "bias": 0.5, "threshold": 0.6}
M3 = {"features": ["a", "c"], "weights": [1.0, 1.0], "bias": 0.0}


def make(*pairs):
    r = ModelRegistry()
    for v, m in pairs:
        r.register(v, m)
    return r


def test_register_validation():
    r = ModelRegistry()
    bad = [
        {**M1, "features": []},
        {**M1, "features": ["a", "a"], "weights": [1, 1]},
        {**M1, "features": ["a", ""], "weights": [1, 1]},
        {**M1, "weights": [1.0]},
        {**M1, "weights": [1.0, float("nan")]},
        {**M1, "weights": [1.0, True]},
        {**M1, "bias": float("inf")},
        {**M1, "bias": "0"},
        {**M1, "threshold": 0},
        {**M1, "threshold": 1},
        {"features": ["a"], "weights": [1]},
        "not a dict",
    ]
    for m in bad:
        with pytest.raises(ValueError):
            r.register("v", m)
    for v in ("", None, 1):
        with pytest.raises(ValueError):
            r.register(v, M1)
    assert r.versions() == []


def test_versions_are_immutable_and_order_kept():
    r = make(("v2", M2), ("v1", M1))
    assert r.versions() == ["v2", "v1"]
    r.register("v1", copy.deepcopy(M1))  # равная модель – без эффекта
    assert r.versions() == ["v2", "v1"]
    with pytest.raises(ValueError):
        r.register("v1", {**M1, "bias": 1.0})
    assert r.get_model("v1") == M1


def test_registry_keeps_copy():
    m = copy.deepcopy(M1)
    r = make(("v1", m))
    m["weights"][0] = 99.0
    m["features"].append("z")
    assert r.get_model("v1") == M1
    got = r.get_model("v1")
    got["bias"] = 5
    assert r.get_model("v1") == M1
    with pytest.raises(KeyError):
        r.get_model("nope")


def test_activate_unknown_and_first_activation_always_ok():
    r = make(("v1", M1))
    with pytest.raises(KeyError):
        r.activate("zzz")
    r.activate("v1")
    assert r.active_version() == "v1"


def test_schema_compat_is_set_equality_order_irrelevant():
    r = make(("v1", M1), ("v2", M2), ("v3", M3))
    r.activate("v1")
    r.activate("v2")  # {b, a} == {a, b}
    assert r.active_version() == "v2"
    with pytest.raises(ValueError):
        r.activate("v3")
    assert r.active_version() == "v2"
    r.activate("v3", allow_schema_change=True)
    assert r.active_version() == "v3"


def test_activate_same_version_is_noop_for_history():
    r = make(("v1", M1), ("v2", M2))
    r.activate("v1")
    r.activate("v1")
    r.activate("v2")
    assert r.rollback() == "v1"
    with pytest.raises(LookupError):
        r.rollback()


def test_rollback_goes_deeper_and_ignores_schema():
    r = make(("a", M1), ("b", M2), ("c", M3))
    r.activate("a")
    r.activate("b")
    r.activate("c", allow_schema_change=True)
    assert r.rollback() == "b"  # a/b/c: откат в c->b несовместим по схеме, но разрешён
    assert r.rollback() == "a"
    assert r.active_version() == "a"
    with pytest.raises(LookupError):
        r.rollback()
    assert r.active_version() == "a"


def test_rollback_on_empty_registry():
    with pytest.raises(LookupError):
        ModelRegistry().rollback()


def test_predict_errors_for_version_selection():
    r = make(("v1", M1))
    with pytest.raises(RuntimeError):
        r.predict_batch([{"a": 1, "b": 1}])
    r.activate("v1")
    with pytest.raises(KeyError):
        r.predict_batch([], version="nope")
    out = r.predict_batch([])
    assert out == {"version": "v1", "results": [], "n_ok": 0, "n_failed": 0}


def test_predict_explicit_version_and_threshold():
    r = make(("v1", M1), ("v2", M2))
    r.activate("v1")
    row = {"a": 0.0, "b": 0.0}
    # v1: score 0.5 >= 0.5 -> 1; v2: z=0.5 -> ~0.622 >= 0.6 -> 1; а вот с порогом выше метка 0
    assert r.predict_batch([row])["results"][0]["label"] == 1
    r.register("v4", {**M1, "threshold": 0.9})
    out = r.predict_batch([{"a": 1.0, "b": 0.0}], version="v4")
    assert out["version"] == "v4" and out["results"][0]["label"] == 0
    assert out["results"][0]["score"] == pytest.approx(1 / (1 + math.exp(-1)))


def test_weights_bind_by_name_not_position():
    r = make(("v2", M2))
    r.activate("v2")
    s = r.predict_batch([{"a": 1.0, "b": 0.0}])["results"][0]["score"]  # z = 0.5 + 1*1
    assert s == pytest.approx(1 / (1 + math.exp(-1.5)))


def test_row_error_codes_and_extra_keys():
    r = make(("v1", M1))
    r.activate("v1")
    rows = [
        {"b": 1},                    # нет a (первый по порядку features)
        {},                          # тоже нет a
        {"a": "1", "b": 1},          # строка
        {"a": True, "b": 1},         # bool
        {"a": 1, "b": float("nan")},
        {"a": float("inf"), "b": 1},
        {"a": 1, "b": 0, "zzz": "ignored"},
        None,
        [1, 2],
    ]
    out = r.predict_batch(rows)
    assert [x.get("error") for x in out["results"]] == [
        "missing_feature:a", "missing_feature:a", "bad_value:a", "bad_value:a", "bad_value:b", "bad_value:a", None, "not_a_dict", "not_a_dict",
    ]
    assert [x["index"] for x in out["results"]] == list(range(9))
    assert (out["n_ok"], out["n_failed"]) == (1, 8)
    assert out["results"][6]["ok"] is True and out["results"][0]["ok"] is False


def test_sigmoid_does_not_overflow():
    r = make(("v1", {"features": ["x"], "weights": [1.0], "bias": 0.0}))
    r.activate("v1")
    out = r.predict_batch([{"x": 1000}, {"x": -1000}, {"x": 1e6}, {"x": -1e6}])
    assert [x["score"] for x in out["results"]] == [1.0, 0.0, 1.0, 0.0]
    assert [x["label"] for x in out["results"]] == [1, 0, 1, 0]


def test_version_pinned_for_whole_batch_even_if_activation_changes():
    r = make(("v1", M1), ("v2", M2))
    r.activate("v1")

    def rows():
        yield {"a": 1, "b": 0}
        r.activate("v2")  # переключение посреди чтения пачки
        yield {"a": 1, "b": 0}

    out = r.predict_batch(rows())
    assert out["version"] == "v1"
    assert out["results"][0]["score"] == out["results"][1]["score"] == pytest.approx(1 / (1 + math.exp(-1)))
    assert r.active_version() == "v2"


def test_export_state_is_json_and_roundtrips_with_rollback():
    r = make(("v1", M1), ("v2", M2), ("v3", M3))
    r.activate("v1")
    r.activate("v2")
    state = json.loads(json.dumps(r.export_state()))
    r2 = ModelRegistry.from_state(state)
    assert r2.versions() == ["v1", "v2", "v3"] and r2.active_version() == "v2"
    assert r2.get_model("v2") == M2
    assert r2.rollback() == "v1"
    with pytest.raises(LookupError):
        r2.rollback()
    assert r.active_version() == "v2"  # исходный реестр не затронут
    row = [{"a": 1, "b": 2}]
    r3 = ModelRegistry.from_state(json.loads(json.dumps(r.export_state())))
    assert r3.predict_batch(row) == r.predict_batch(row)


def test_from_state_validation_and_isolation():
    r = make(("v1", M1), ("v2", M2))
    r.activate("v1")
    r.activate("v2")
    good = json.loads(json.dumps(r.export_state()))
    for mutate in (
        lambda s: s.update(active="ghost"),
        lambda s: s.update(history=["ghost"]),
        lambda s: s["models"]["v1"].update(weights=[1.0]),
        lambda s: s["models"]["v2"].update(bias="x"),
    ):
        s = copy.deepcopy(good)
        mutate(s)
        with pytest.raises(ValueError):
            ModelRegistry.from_state(s)
    s = copy.deepcopy(good)
    r4 = ModelRegistry.from_state(s)
    s["models"]["v1"]["bias"] = 42.0
    assert r4.get_model("v1") == M1


def test_design_md_sections():
    path = os.path.join(os.path.dirname(os.path.abspath(registry.__file__)), "DESIGN.md")
    assert os.path.exists(path), "нет DESIGN.md в корне репозитория"
    text = open(path, encoding="utf-8").read()
    for h in ("Решения", "Компромиссы", "Границы применимости"):
        m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
        assert m is not None, h
        assert len(m.group(1).strip()) >= 200, h
