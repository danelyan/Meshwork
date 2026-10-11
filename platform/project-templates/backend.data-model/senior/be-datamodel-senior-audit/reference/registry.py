"""Версионируемый каталог с аудитом поверх SQLite по контракту (contract.md)."""
import json
import sqlite3
import time
from contextlib import contextmanager


class DataError(Exception):
    pass


class DuplicateError(DataError):
    pass


class NotFoundError(DataError):
    pass


class ValidationError(DataError):
    pass


class ConflictError(DataError):
    def __init__(self, current_version):
        super().__init__(f"текущая версия {current_version}")
        self.current_version = current_version


SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    price_kop INTEGER NOT NULL CHECK (price_kop >= 0),
    version INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit (
    key TEXT NOT NULL,
    version INTEGER NOT NULL,
    op TEXT NOT NULL,
    actor TEXT NOT NULL,
    at INTEGER NOT NULL,
    title TEXT NOT NULL,
    price_kop INTEGER NOT NULL,
    deleted INTEGER NOT NULL,
    changes TEXT NOT NULL,
    PRIMARY KEY (key, version)
);
CREATE INDEX IF NOT EXISTS audit_at ON audit (key, at, version);
"""


class _Conn(sqlite3.Connection):
    _clock = None


def connect(path=":memory:", clock=None):
    # isolation_level=None: транзакциями управляем явно (BEGIN IMMEDIATE), неявных BEGIN нет.
    conn = sqlite3.connect(path, timeout=30, isolation_level=None, check_same_thread=False, factory=_Conn)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.row_factory = sqlite3.Row
    conn._clock = clock or (lambda: int(time.time()))
    for stmt in SCHEMA.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    return conn


@contextmanager
def _tx(conn):
    # IMMEDIATE берёт блокировку записи сразу: проверка версии и запись идут под одним замком.
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _check_str(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{name}: непустая строка")


def _check_title(v):
    _check_str(v, "title")


def _check_price(v):
    if not isinstance(v, int) or isinstance(v, bool) or v < 0:
        raise ValidationError("price_kop: целое >= 0")


def _check_int(v, name):
    if not isinstance(v, int) or isinstance(v, bool):
        raise ValidationError(f"{name}: целое число")


def _record(row):
    return {
        "key": row["key"],
        "title": row["title"],
        "price_kop": row["price_kop"],
        "version": row["version"],
        "deleted": bool(row["deleted"]),
    }


def _load(conn, key):
    row = conn.execute("SELECT * FROM items WHERE key = ?", (key,)).fetchone()
    if row is None:
        raise NotFoundError(key)
    return row


def _diff(old, new):
    out = {}
    for f in ("title", "price_kop"):
        if old[f] != new[f]:
            out[f] = [old[f], new[f]]
    return out


def _write(conn, key, op, actor, state, version, changes, insert):
    at = conn._clock()
    if insert:
        conn.execute(
            "INSERT INTO items (key, title, price_kop, version, deleted) VALUES (?,?,?,?,?)",
            (key, state["title"], state["price_kop"], version, int(state["deleted"])),
        )
    else:
        conn.execute(
            "UPDATE items SET title=?, price_kop=?, version=?, deleted=? WHERE key=?",
            (state["title"], state["price_kop"], version, int(state["deleted"]), key),
        )
    conn.execute(
        "INSERT INTO audit (key, version, op, actor, at, title, price_kop, deleted, changes) VALUES (?,?,?,?,?,?,?,?,?)",
        (key, version, op, actor, at, state["title"], state["price_kop"], int(state["deleted"]),
         json.dumps(changes, ensure_ascii=False)),
    )
    return {"key": key, "title": state["title"], "price_kop": state["price_kop"],
            "version": version, "deleted": bool(state["deleted"])}


def create(conn, key, title, price_kop, actor):
    _check_str(key, "key")
    _check_title(title)
    _check_price(price_kop)
    _check_str(actor, "actor")
    with _tx(conn):
        if conn.execute("SELECT 1 FROM items WHERE key = ?", (key,)).fetchone():
            raise DuplicateError(key)
        state = {"title": title, "price_kop": price_kop, "deleted": False}
        changes = {"title": [None, title], "price_kop": [None, price_kop]}
        return _write(conn, key, "create", actor, state, 1, changes, insert=True)


def _mutate(conn, key, expected_version, actor, op, build):
    """Общий каркас: проверка версии под замком записи, построение нового состояния, запись + журнал."""
    _check_str(key, "key")
    _check_int(expected_version, "expected_version")
    _check_str(actor, "actor")
    with _tx(conn):
        row = _load(conn, key)
        new_state, error = build(row)
        if error is not None:
            raise error
        if row["version"] != expected_version:
            raise ConflictError(row["version"])
        changes = _diff(row, new_state)
        if not changes and bool(row["deleted"]) == new_state["deleted"]:
            return _record(row)
        return _write(conn, key, op, actor, new_state, row["version"] + 1, changes, insert=False)


def update(conn, key, changes, expected_version, actor):
    if not isinstance(changes, dict) or not changes or set(changes) - {"title", "price_kop"}:
        raise ValidationError("changes: непустой словарь из title/price_kop")
    if "title" in changes:
        _check_title(changes["title"])
    if "price_kop" in changes:
        _check_price(changes["price_kop"])

    def build(row):
        if row["deleted"]:
            return None, NotFoundError(key)
        state = {"title": row["title"], "price_kop": row["price_kop"], "deleted": False}
        state.update(changes)
        return state, None

    return _mutate(conn, key, expected_version, actor, "update", build)


def delete(conn, key, expected_version, actor):
    def build(row):
        if row["deleted"]:
            return None, NotFoundError(key)
        return {"title": row["title"], "price_kop": row["price_kop"], "deleted": True}, None

    return _mutate(conn, key, expected_version, actor, "delete", build)


def restore(conn, key, expected_version, actor):
    def build(row):
        if not row["deleted"]:
            return None, ValidationError("позиция не удалена")
        return {"title": row["title"], "price_kop": row["price_kop"], "deleted": False}, None

    return _mutate(conn, key, expected_version, actor, "restore", build)


def revert(conn, key, to_version, expected_version, actor):
    _check_int(to_version, "to_version")

    def build(row):
        if to_version < 1 or to_version > row["version"]:
            return None, ValidationError("to_version вне диапазона")
        old = conn.execute(
            "SELECT title, price_kop, deleted FROM audit WHERE key = ? AND version = ?", (key, to_version)
        ).fetchone()
        return {"title": old["title"], "price_kop": old["price_kop"], "deleted": bool(old["deleted"])}, None

    return _mutate(conn, key, expected_version, actor, "revert", build)


def get(conn, key, include_deleted=False):
    _check_str(key, "key")
    row = _load(conn, key)
    if row["deleted"] and not include_deleted:
        raise NotFoundError(key)
    return _record(row)


def list_active(conn):
    rows = conn.execute("SELECT * FROM items WHERE deleted = 0 ORDER BY key").fetchall()
    return [_record(r) for r in rows]


def history(conn, key):
    _check_str(key, "key")
    _load(conn, key)
    rows = conn.execute(
        "SELECT version, op, actor, at, changes FROM audit WHERE key = ? ORDER BY version", (key,)
    ).fetchall()
    return [
        {"version": r["version"], "op": r["op"], "actor": r["actor"], "at": r["at"],
         "changes": json.loads(r["changes"])}
        for r in rows
    ]


def _state_at(conn, key, at):
    return conn.execute(
        "SELECT * FROM audit WHERE key = ? AND at <= ? ORDER BY version DESC LIMIT 1", (key, at)
    ).fetchone()


def as_of(conn, key, at):
    _check_str(key, "key")
    _check_int(at, "at")
    row = _state_at(conn, key, at)
    if row is None or row["deleted"]:
        raise NotFoundError(key)
    return _record(row)


def snapshot(conn, at):
    _check_int(at, "at")
    out = []
    for (key,) in conn.execute("SELECT key FROM items ORDER BY key").fetchall():
        row = _state_at(conn, key, at)
        if row is not None and not row["deleted"]:
            out.append(_record(row))
    return out
