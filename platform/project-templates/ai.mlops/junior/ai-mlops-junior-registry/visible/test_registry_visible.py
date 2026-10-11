# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
from datetime import datetime, timezone

import pytest

from registry import ModelRegistry, TransitionError


def clock():
    return datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc)


def test_register_assigns_versions_and_staging():
    r = ModelRegistry(clock=clock)
    a = r.register("churn", {"auc": 0.9}, {"depth": 3})
    b = r.register("churn", {"auc": 0.92})
    assert (a["version"], b["version"]) == (1, 2)
    assert a == {"name": "churn", "version": 1, "stage": "staging", "metrics": {"auc": 0.9},
                 "params": {"depth": 3}, "created_at": "2026-10-01T10:00:00+00:00"}
    assert b["params"] == {}


def test_single_production_per_model():
    r = ModelRegistry(clock=clock)
    r.register("churn", {"auc": 0.9})
    r.register("churn", {"auc": 0.92})
    r.promote("churn", 1, "production")
    r.promote("churn", 2, "production")
    assert r.production("churn")["version"] == 2
    assert r.get("churn", 1)["stage"] == "archived"


def test_archived_is_final():
    r = ModelRegistry(clock=clock)
    r.register("churn", {"auc": 0.9})
    r.promote("churn", 1, "archived")
    with pytest.raises(TransitionError):
        r.promote("churn", 1, "staging")


def test_best_prefers_higher_and_skips_archived():
    r = ModelRegistry(clock=clock)
    for auc in (0.8, 0.95, 0.9):
        r.register("churn", {"auc": auc})
    r.promote("churn", 2, "archived")
    assert r.best("churn", "auc")["version"] == 3
