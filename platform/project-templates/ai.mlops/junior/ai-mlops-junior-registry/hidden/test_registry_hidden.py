# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import json
from datetime import datetime, timedelta, timezone

import pytest

from registry import ModelRegistry, TransitionError


class Clock:
    def __init__(self):
        self.t = datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc)

    def __call__(self):
        self.t += timedelta(minutes=1)
        return self.t


@pytest.fixture
def reg():
    return ModelRegistry(clock=Clock())


def test_versions_are_per_model(reg):
    assert reg.register("a", {"m": 1})["version"] == 1
    assert reg.register("b", {"m": 1})["version"] == 1
    assert reg.register("a", {"m": 2})["version"] == 2


def test_created_at_from_injected_clock(reg):
    first = reg.register("a", {"m": 1})
    second = reg.register("a", {"m": 1})
    assert first["created_at"] == "2026-10-01T10:01:00+00:00"
    assert second["created_at"] == "2026-10-01T10:02:00+00:00"


@pytest.mark.parametrize("name,metrics,params", [
    ("", {"m": 1}, None),
    (None, {"m": 1}, None),
    ("a", {}, None),
    ("a", [("m", 1)], None),
    ("a", {"m": "0.9"}, None),
    ("a", {"m": True}, None),
    ("a", {"m": float("nan")}, None),
    ("a", {"m": float("inf")}, None),
    ("a", {1: 0.5}, None),
    ("a", {"m": 1}, [1]),
])
def test_register_validation(reg, name, metrics, params):
    with pytest.raises(ValueError):
        reg.register(name, metrics, params)
    assert reg.list_versions("a") == []


def test_returns_copies_and_copies_input(reg):
    metrics = {"auc": 0.9}
    reg.register("a", metrics, {"x": [1]})
    metrics["auc"] = 0.1
    got = reg.get("a", 1)
    got["metrics"]["auc"] = 0.0
    got["params"]["x"].append(2)
    got["stage"] = "production"
    again = reg.get("a", 1)
    assert again["metrics"] == {"auc": 0.9}
    assert again["params"] == {"x": [1]}
    assert again["stage"] == "staging"
    reg.list_versions("a")[0]["stage"] = "archived"
    assert reg.get("a", 1)["stage"] == "staging"


def test_get_unknown_raises_keyerror(reg):
    reg.register("a", {"m": 1})
    for args in (("zzz", 1), ("a", 2), ("a", 0)):
        with pytest.raises(KeyError):
            reg.get(*args)


def test_list_versions_order_and_filter(reg):
    for _ in range(3):
        reg.register("a", {"m": 1})
    reg.promote("a", 2, "production")
    assert [v["version"] for v in reg.list_versions("a")] == [1, 2, 3]
    assert [v["version"] for v in reg.list_versions("a", "staging")] == [1, 3]
    assert [v["version"] for v in reg.list_versions("a", "production")] == [2]
    assert reg.list_versions("nope") == []
    with pytest.raises(ValueError):
        reg.list_versions("a", "dev")


def test_promote_validation_and_unknowns(reg):
    reg.register("a", {"m": 1})
    with pytest.raises(ValueError):
        reg.promote("a", 1, "dev")
    with pytest.raises(KeyError):
        reg.promote("a", 5, "production")
    with pytest.raises(KeyError):
        reg.promote("zzz", 1, "production")


def test_promote_same_stage_and_archived_are_errors(reg):
    reg.register("a", {"m": 1})
    with pytest.raises(TransitionError):
        reg.promote("a", 1, "staging")
    reg.promote("a", 1, "production")
    with pytest.raises(TransitionError):
        reg.promote("a", 1, "production")
    reg.promote("a", 1, "archived")
    for stage in ("staging", "production", "archived"):
        with pytest.raises(TransitionError):
            reg.promote("a", 1, stage)


def test_production_switch_archives_previous_only_for_same_model(reg):
    reg.register("a", {"m": 1})
    reg.register("a", {"m": 2})
    reg.register("b", {"m": 1})
    reg.promote("a", 1, "production")
    reg.promote("b", 1, "production")
    result = reg.promote("a", 2, "production")
    assert result["stage"] == "production"
    assert reg.get("a", 1)["stage"] == "archived"
    assert reg.production("b")["version"] == 1
    assert len(reg.list_versions("a", "production")) == 1


def test_demote_production_to_staging_leaves_no_production(reg):
    reg.register("a", {"m": 1})
    reg.promote("a", 1, "production")
    reg.promote("a", 1, "staging")
    assert reg.production("a") is None


def test_failed_promote_keeps_state(reg):
    reg.register("a", {"m": 1})
    reg.register("a", {"m": 2})
    reg.promote("a", 1, "production")
    reg.promote("a", 2, "archived")
    with pytest.raises(TransitionError):
        reg.promote("a", 2, "production")
    assert reg.production("a")["version"] == 1


def test_production_unknown_is_none(reg):
    assert reg.production("zzz") is None
    reg.register("a", {"m": 1})
    assert reg.production("a") is None


def test_best_directions_ties_and_missing_metric(reg):
    reg.register("a", {"auc": 0.9, "latency": 50})
    reg.register("a", {"auc": 0.9, "latency": 30})
    reg.register("a", {"latency": 10})
    assert reg.best("a", "auc")["version"] == 2          # ничья — больший номер
    assert reg.best("a", "latency", higher_is_better=False)["version"] == 3
    assert reg.best("a", "latency")["version"] == 1
    assert reg.best("a", "f1") is None
    assert reg.best("zzz", "auc") is None


def test_best_stage_filter(reg):
    for auc in (0.7, 0.9, 0.8):
        reg.register("a", {"auc": auc})
    reg.promote("a", 2, "archived")
    reg.promote("a", 3, "production")
    assert reg.best("a", "auc")["version"] == 3
    assert reg.best("a", "auc", stages=("archived",))["version"] == 2
    assert reg.best("a", "auc", stages=("staging", "archived"))["version"] == 2
    assert reg.best("a", "auc", stages=())  is None


def test_persistence_roundtrip(tmp_path):
    path = str(tmp_path / "registry.json")
    r1 = ModelRegistry(path, clock=Clock())
    r1.register("a", {"auc": 0.9}, {"depth": 2})
    r1.register("a", {"auc": 0.95})
    r1.promote("a", 2, "production")
    r2 = ModelRegistry(path, clock=Clock())
    assert r2.production("a")["version"] == 2
    assert r2.get("a", 1) == r1.get("a", 1)
    assert r2.register("a", {"auc": 0.5})["version"] == 3
    r3 = ModelRegistry(path)
    assert len(r3.list_versions("a")) == 3
    json.loads((tmp_path / "registry.json").read_text(encoding="utf-8"))


def test_failed_register_does_not_write_file(tmp_path):
    path = tmp_path / "registry.json"
    r = ModelRegistry(str(path))
    with pytest.raises(ValueError):
        r.register("a", {})
    assert ModelRegistry(str(path)).list_versions("a") == []


def test_broken_file_raises_valueerror(tmp_path):
    path = tmp_path / "registry.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ValueError):
        ModelRegistry(str(path))
