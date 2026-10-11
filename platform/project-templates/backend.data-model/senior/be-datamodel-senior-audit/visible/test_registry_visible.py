# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pytest

import registry


class Clock:
    def __init__(self, t=1000):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def conn(clock):
    c = registry.connect(clock=clock)
    yield c
    c.close()


def test_create_update_bumps_version_and_logs_diff(conn, clock):
    registry.create(conn, "pen", "Pen", 100, "ann")
    clock.t = 1005
    rec = registry.update(conn, "pen", {"price_kop": 120}, 1, "bob")
    assert rec == {"key": "pen", "title": "Pen", "price_kop": 120, "version": 2, "deleted": False}
    h = registry.history(conn, "pen")
    assert h[1] == {"version": 2, "op": "update", "actor": "bob", "at": 1005, "changes": {"price_kop": [100, 120]}}


def test_stale_version_conflicts_without_side_effects(conn):
    registry.create(conn, "pen", "Pen", 100, "ann")
    registry.update(conn, "pen", {"title": "Pen2"}, 1, "ann")
    with pytest.raises(registry.ConflictError) as e:
        registry.update(conn, "pen", {"title": "Pen3"}, 1, "bob")
    assert e.value.current_version == 2
    assert registry.get(conn, "pen")["title"] == "Pen2"
    assert len(registry.history(conn, "pen")) == 2


def test_soft_delete_hides_but_keeps_history(conn):
    registry.create(conn, "pen", "Pen", 100, "ann")
    registry.delete(conn, "pen", 1, "ann")
    with pytest.raises(registry.NotFoundError):
        registry.get(conn, "pen")
    assert registry.get(conn, "pen", include_deleted=True)["deleted"] is True
    assert registry.list_active(conn) == []
    assert [x["op"] for x in registry.history(conn, "pen")] == ["create", "delete"]


def test_as_of_returns_past_state(conn, clock):
    registry.create(conn, "pen", "Pen", 100, "ann")
    clock.t = 2000
    registry.update(conn, "pen", {"price_kop": 500}, 1, "ann")
    assert registry.as_of(conn, "pen", 1500)["price_kop"] == 100
    assert registry.as_of(conn, "pen", 2000)["price_kop"] == 500
    with pytest.raises(registry.NotFoundError):
        registry.as_of(conn, "pen", 999)
