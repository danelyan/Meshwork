# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import os
import re
import threading

import pytest

import registry


class Clock:
    def __init__(self, t=1000):
        self.t = t
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def conn(clock):
    c = registry.connect(clock=clock)
    yield c
    c.close()


def test_create_returns_record_and_logs(conn, clock):
    rec = registry.create(conn, "pen", "Pen", 100, "ann")
    assert rec == {"key": "pen", "title": "Pen", "price_kop": 100, "version": 1, "deleted": False}
    assert registry.history(conn, "pen") == [
        {"version": 1, "op": "create", "actor": "ann", "at": 1000,
         "changes": {"title": [None, "Pen"], "price_kop": [None, 100]}}
    ]
    assert clock.calls == 1


def test_duplicate_key_including_deleted(conn):
    registry.create(conn, "pen", "Pen", 100, "ann")
    with pytest.raises(registry.DuplicateError):
        registry.create(conn, "pen", "Other", 1, "ann")
    registry.delete(conn, "pen", 1, "ann")
    with pytest.raises(registry.DuplicateError):
        registry.create(conn, "pen", "Other", 1, "ann")


@pytest.mark.parametrize(
    "args",
    [
        ("", "T", 1, "a"), ("k", "  ", 1, "a"), ("k", 5, 1, "a"), ("k", "T", -1, "a"),
        ("k", "T", True, "a"), ("k", "T", 1.5, "a"), ("k", "T", 1, ""), ("k", "T", 1, None),
    ],
)
def test_create_validation(conn, args):
    with pytest.raises(registry.ValidationError):
        registry.create(conn, *args)
    assert registry.list_active(conn) == []


@pytest.mark.parametrize(
    "changes",
    [{}, {"foo": 1}, {"title": "X", "foo": 1}, {"price_kop": -5}, {"title": ""}, {"price_kop": False}, None],
)
def test_update_validation(conn, changes):
    registry.create(conn, "pen", "Pen", 100, "ann")
    with pytest.raises(registry.ValidationError):
        registry.update(conn, "pen", changes, 1, "ann")
    assert registry.get(conn, "pen")["version"] == 1


def test_update_partial_fields_and_diff_only_changed(conn):
    registry.create(conn, "pen", "Pen", 100, "ann")
    rec = registry.update(conn, "pen", {"title": "Pen", "price_kop": 90}, 1, "ann")
    assert rec["version"] == 2 and rec["title"] == "Pen" and rec["price_kop"] == 90
    assert registry.history(conn, "pen")[1]["changes"] == {"price_kop": [100, 90]}


def test_noop_update_changes_nothing_but_checks_version(conn, clock):
    registry.create(conn, "pen", "Pen", 100, "ann")
    before = clock.calls
    rec = registry.update(conn, "pen", {"title": "Pen", "price_kop": 100}, 1, "bob")
    assert rec["version"] == 1
    assert len(registry.history(conn, "pen")) == 1
    with pytest.raises(registry.ConflictError):
        registry.update(conn, "pen", {"title": "Pen"}, 7, "bob")
    assert clock.calls - before <= 2


def test_check_order_validation_then_notfound_then_conflict(conn):
    with pytest.raises(registry.ValidationError):
        registry.update(conn, "nope", {}, 1, "a")
    with pytest.raises(registry.NotFoundError):
        registry.update(conn, "nope", {"title": "X"}, 99, "a")
    registry.create(conn, "pen", "Pen", 100, "a")
    registry.delete(conn, "pen", 1, "a")
    with pytest.raises(registry.NotFoundError):
        registry.update(conn, "pen", {"title": "X"}, 99, "a")
    with pytest.raises(registry.NotFoundError):
        registry.delete(conn, "pen", 99, "a")


def test_expected_version_must_be_int(conn):
    registry.create(conn, "pen", "Pen", 100, "a")
    for bad in ("1", None, 1.0, True):
        with pytest.raises(registry.ValidationError):
            registry.update(conn, "pen", {"title": "X"}, bad, "a")


def test_delete_restore_cycle_versions(conn):
    registry.create(conn, "pen", "Pen", 100, "a")
    assert registry.delete(conn, "pen", 1, "a")["deleted"] is True
    registry.restore(conn, "pen", 2, "a")
    with pytest.raises(registry.ValidationError):
        registry.restore(conn, "pen", 3, "a")
    rec = registry.get(conn, "pen")
    assert rec["version"] == 3 and rec["deleted"] is False
    assert [h["op"] for h in registry.history(conn, "pen")] == ["create", "delete", "restore"]
    assert registry.history(conn, "pen")[1]["changes"] == {}


def test_double_delete_is_not_found(conn):
    registry.create(conn, "pen", "Pen", 100, "a")
    registry.delete(conn, "pen", 1, "a")
    with pytest.raises(registry.NotFoundError):
        registry.delete(conn, "pen", 2, "a")


def test_get_missing_and_list_sorted(conn):
    with pytest.raises(registry.NotFoundError):
        registry.get(conn, "nope")
    for k in ("b", "c", "a"):
        registry.create(conn, k, k.upper(), 1, "x")
    registry.delete(conn, "c", 1, "x")
    assert [r["key"] for r in registry.list_active(conn)] == ["a", "b"]


def test_revert_creates_new_version_and_keeps_history(conn, clock):
    registry.create(conn, "pen", "Pen", 100, "a")
    clock.t = 1001
    registry.update(conn, "pen", {"price_kop": 200, "title": "Pen Pro"}, 1, "a")
    clock.t = 1002
    rec = registry.revert(conn, "pen", 1, 2, "boss")
    assert rec == {"key": "pen", "title": "Pen", "price_kop": 100, "version": 3, "deleted": False}
    h = registry.history(conn, "pen")
    assert [x["op"] for x in h] == ["create", "update", "revert"]
    assert h[2]["changes"] == {"title": ["Pen Pro", "Pen"], "price_kop": [200, 100]}
    assert h[1]["changes"] == {"title": ["Pen", "Pen Pro"], "price_kop": [100, 200]}


def test_revert_restores_deleted_flag_and_works_on_deleted(conn):
    registry.create(conn, "pen", "Pen", 100, "a")
    registry.delete(conn, "pen", 1, "a")
    rec = registry.revert(conn, "pen", 1, 2, "a")
    assert rec["deleted"] is False and rec["version"] == 3
    assert registry.history(conn, "pen")[2]["changes"] == {}
    rec = registry.revert(conn, "pen", 2, 3, "a")
    assert rec["deleted"] is True and rec["version"] == 4


def test_revert_validation_and_noop(conn):
    registry.create(conn, "pen", "Pen", 100, "a")
    registry.update(conn, "pen", {"price_kop": 5}, 1, "a")
    for bad in (0, 3, -1, "1", True):
        with pytest.raises(registry.ValidationError):
            registry.revert(conn, "pen", bad, 2, "a")
    with pytest.raises(registry.ConflictError):
        registry.revert(conn, "pen", 1, 1, "a")
    assert registry.revert(conn, "pen", 2, 2, "a")["version"] == 2
    assert len(registry.history(conn, "pen")) == 2


def test_history_is_immutable_and_missing_key(conn):
    with pytest.raises(registry.NotFoundError):
        registry.history(conn, "nope")
    registry.create(conn, "pen", "Pen", 100, "a")
    first = registry.history(conn, "pen")[0]
    registry.update(conn, "pen", {"title": "New"}, 1, "a")
    registry.delete(conn, "pen", 2, "a")
    assert registry.history(conn, "pen")[0] == first


def test_as_of_boundaries_equal_timestamps_and_deleted(conn, clock):
    registry.create(conn, "pen", "Pen", 100, "a")            # v1 @1000
    registry.update(conn, "pen", {"price_kop": 150}, 1, "a")  # v2 @1000
    clock.t = 1100
    registry.delete(conn, "pen", 2, "a")                      # v3 @1100
    clock.t = 1200
    registry.restore(conn, "pen", 3, "a")                     # v4 @1200
    assert registry.as_of(conn, "pen", 1000)["version"] == 2
    assert registry.as_of(conn, "pen", 1099)["price_kop"] == 150
    with pytest.raises(registry.NotFoundError):
        registry.as_of(conn, "pen", 1100)
    assert registry.as_of(conn, "pen", 1200)["version"] == 4
    assert registry.as_of(conn, "pen", 10**9)["deleted"] is False
    with pytest.raises(registry.NotFoundError):
        registry.as_of(conn, "pen", 999)
    with pytest.raises(registry.NotFoundError):
        registry.as_of(conn, "nope", 1200)
    for bad in ("1000", None, 1.5):
        with pytest.raises(registry.ValidationError):
            registry.as_of(conn, "pen", bad)


def test_snapshot_reflects_moment(conn, clock):
    registry.create(conn, "b", "B", 2, "a")      # @1000
    clock.t = 1010
    registry.create(conn, "a", "A", 1, "a")      # @1010
    clock.t = 1020
    registry.update(conn, "b", {"price_kop": 20}, 1, "a")
    clock.t = 1030
    registry.delete(conn, "a", 1, "a")
    assert registry.snapshot(conn, 999) == []
    s = registry.snapshot(conn, 1015)
    assert [(r["key"], r["price_kop"], r["version"]) for r in s] == [("a", 1, 1), ("b", 2, 1)]
    s = registry.snapshot(conn, 1025)
    assert [(r["key"], r["price_kop"], r["version"]) for r in s] == [("a", 1, 1), ("b", 20, 2)]
    s = registry.snapshot(conn, 1030)
    assert [(r["key"], r["version"]) for r in s] == [("b", 2)]
    with pytest.raises(registry.ValidationError):
        registry.snapshot(conn, "x")


def test_data_persists_across_connections(tmp_path):
    path = str(tmp_path / "r.db")
    c1 = registry.connect(path, clock=Clock())
    registry.create(c1, "pen", "Pen", 100, "a")
    c1.close()
    c2 = registry.connect(path, clock=Clock(2000))
    assert registry.get(c2, "pen")["version"] == 1
    registry.update(c2, "pen", {"title": "P2"}, 1, "a")
    assert [h["at"] for h in registry.history(c2, "pen")] == [1000, 2000]
    c2.close()


def _race(path, n, work):
    barrier = threading.Barrier(n)
    results = [None] * n

    def run(i):
        c = registry.connect(path, clock=Clock(5000 + i))
        try:
            barrier.wait(timeout=20)
            results[i] = work(c, i)
        except BaseException as e:  # noqa: BLE001
            results[i] = e
        finally:
            c.close()

    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(60)
    return results


def test_concurrent_updates_same_expected_version_one_winner(tmp_path):
    path = str(tmp_path / "r.db")
    c = registry.connect(path, clock=Clock())
    registry.create(c, "pen", "Pen", 100, "a")
    res = _race(path, 8, lambda cc, i: registry.update(cc, "pen", {"price_kop": 200 + i}, 1, f"u{i}"))
    ok = [r for r in res if isinstance(r, dict)]
    errs = [r for r in res if not isinstance(r, dict)]
    assert len(ok) == 1, res
    assert all(isinstance(e, registry.ConflictError) and e.current_version == 2 for e in errs), res
    h = registry.history(c, "pen")
    assert [x["version"] for x in h] == [1, 2]
    assert h[1]["actor"] == f"u{ok[0]['price_kop'] - 200}"
    assert registry.get(c, "pen")["price_kop"] == ok[0]["price_kop"]
    c.close()


def test_concurrent_creates_same_key_one_winner(tmp_path):
    path = str(tmp_path / "r.db")
    registry.connect(path, clock=Clock()).close()
    res = _race(path, 6, lambda cc, i: registry.create(cc, "pen", f"P{i}", i, f"u{i}"))
    assert sum(isinstance(r, dict) for r in res) == 1, res
    assert all(isinstance(r, registry.DuplicateError) for r in res if not isinstance(r, dict)), res
    c = registry.connect(path, clock=Clock())
    assert len(registry.history(c, "pen")) == 1
    c.close()


def test_concurrent_retry_loop_no_gaps_in_versions(tmp_path):
    path = str(tmp_path / "r.db")
    c = registry.connect(path, clock=Clock())
    registry.create(c, "ctr", "Counter", 0, "a")

    def work(cc, i):
        for _ in range(3):
            while True:
                cur = registry.get(cc, "ctr")
                try:
                    registry.update(cc, "ctr", {"price_kop": cur["price_kop"] + 1}, cur["version"], f"u{i}")
                    break
                except registry.ConflictError:
                    continue
        return "done"

    res = _race(path, 5, work)
    assert res == ["done"] * 5, res
    h = registry.history(c, "ctr")
    assert [x["version"] for x in h] == list(range(1, 17))
    assert registry.get(c, "ctr")["price_kop"] == 15
    assert [x["changes"]["price_kop"][1] - x["changes"]["price_kop"][0] for x in h[1:]] == [1] * 15
    c.close()


def test_concurrent_delete_vs_update_consistent(tmp_path):
    path = str(tmp_path / "r.db")
    c = registry.connect(path, clock=Clock())
    registry.create(c, "pen", "Pen", 1, "a")
    res = _race(path, 2, lambda cc, i: registry.delete(cc, "pen", 1, "d") if i == 0
                else registry.update(cc, "pen", {"price_kop": 9}, 1, "u"))
    assert sum(isinstance(r, dict) for r in res) == 1, res
    # проигравший: update после delete видит удалённую позицию (NotFound), delete после update — ConflictError
    assert sum(isinstance(r, (registry.ConflictError, registry.NotFoundError)) for r in res) == 1, res
    assert len(registry.history(c, "pen")) == 2
    c.close()


def test_design_md_sections():
    path = os.path.join(os.path.dirname(os.path.abspath(registry.__file__)), "DESIGN.md")
    assert os.path.exists(path), "нет DESIGN.md в корне репозитория"
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for h in ("Решения", "Компромиссы", "Границы применимости"):
        m = re.search(rf"^## {h}\s*\n(.*?)(?=^## |\Z)", text, re.M | re.S)
        assert m is not None, h
        assert len(m.group(1).strip()) >= 200, h
