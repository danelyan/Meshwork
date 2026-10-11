# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import sqlite3
import threading

import pytest

import migrate


@pytest.fixture
def conn():
    c = migrate.connect()
    yield c
    c.close()


def tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def cols(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def plan(conn, sql, arg=1):
    return " | ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, (arg,)))


def snapshot_schema(conn):
    return sorted(conn.execute("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall())


def test_connect_settings(conn):
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.isolation_level is None
    assert migrate.current_version(conn) == 0
    assert tables(conn) == set()


def test_stepwise_versions(conn):
    assert migrate.migrate(conn, 1) == [1]
    assert tables(conn) == {"members", "books"}
    assert migrate.migrate(conn, 2) == [2]
    assert "loans" in tables(conn)
    assert migrate.migrate(conn, 2) == []
    assert migrate.migrate(conn, 5) == [3, 4, 5]
    assert migrate.migrate(conn, 0 + 5) == []
    assert migrate.current_version(conn) == 5


@pytest.mark.parametrize(
    "sql",
    [
        "INSERT INTO members (email, name) VALUES (NULL, 'A')",
        "INSERT INTO members (email, name) VALUES ('a@x.io', NULL)",
        "INSERT INTO books (isbn, title) VALUES ('1', NULL)",
    ],
)
def test_v1_not_null(conn, sql):
    migrate.migrate(conn, 1)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql)


def test_v1_unique(conn):
    migrate.migrate(conn, 1)
    conn.execute("INSERT INTO members (email, name) VALUES ('a@x.io', 'A')")
    conn.execute("INSERT INTO books (isbn, title) VALUES ('1', 'T')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, name) VALUES ('a@x.io', 'B')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO books (isbn, title) VALUES ('1', 'U')")


def test_v2_loans_constraints(conn):
    migrate.migrate(conn, 2)
    conn.execute("INSERT INTO members (id, email, name) VALUES (1, 'a@x.io', 'A')")
    conn.execute("INSERT INTO books (id, isbn, title) VALUES (1, '1', 'T')")
    conn.execute("INSERT INTO loans (member_id, book_id, loaned_at) VALUES (1, 1, '2026-01-01')")
    conn.execute("INSERT INTO loans (member_id, book_id, loaned_at, returned_at) VALUES (1, 1, '2026-01-01', '2026-01-01')")
    for sql in (
        "INSERT INTO loans (member_id, book_id, loaned_at) VALUES (99, 1, '2026-01-01')",
        "INSERT INTO loans (member_id, book_id, loaned_at) VALUES (1, 99, '2026-01-01')",
        "INSERT INTO loans (member_id, book_id, loaned_at) VALUES (1, 1, NULL)",
        "INSERT INTO loans (member_id, book_id, loaned_at, returned_at) VALUES (1, 1, '2026-02-01', '2026-01-01')",
    ):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(sql)


def test_v3_backfills_status_and_checks(conn):
    migrate.migrate(conn, 2)
    conn.execute("INSERT INTO members (email, name) VALUES ('a@x.io', 'A')")
    migrate.migrate(conn, 3)
    assert conn.execute("SELECT status FROM members").fetchall() == [("active",)]
    conn.execute("INSERT INTO members (email, name, status) VALUES ('b@x.io', 'B', 'blocked')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, name, status) VALUES ('c@x.io', 'C', 'gone')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, name, status) VALUES ('d@x.io', 'D', NULL)")


@pytest.mark.parametrize(
    "name,first,last",
    [
        ("Anna Ivanova", "Anna", "Ivanova"),
        ("Madonna", "Madonna", ""),
        ("Jean Claude Van Damme", "Jean", "Claude Van Damme"),
        ("  Leading   Spaces  ", "Leading", "Spaces"),
        ("Tab\tName", "Tab", "Name"),
        ("", "", ""),
        ("   ", "", ""),
    ],
)
def test_v4_name_split(conn, name, first, last):
    migrate.migrate(conn, 3)
    conn.execute("INSERT INTO members (id, email, name) VALUES (1, 'a@x.io', ?)", (name,))
    migrate.migrate(conn, 4)
    assert conn.execute("SELECT first_name, last_name FROM members WHERE id = 1").fetchone() == (first, last)


def test_v4_preserves_data_links_and_constraints(conn):
    migrate.migrate(conn, 3)
    conn.execute("INSERT INTO members (id, email, name, status) VALUES (5, 'a@x.io', 'Anna Ivanova', 'blocked')")
    conn.execute("INSERT INTO members (id, email, name) VALUES (9, 'b@x.io', 'Boris')")
    conn.execute("INSERT INTO books (id, isbn, title) VALUES (1, '1', 'T')")
    conn.execute("INSERT INTO loans (id, member_id, book_id, loaned_at) VALUES (3, 5, 1, '2026-01-01')")
    conn.execute("INSERT INTO loans (id, member_id, book_id, loaned_at, returned_at) VALUES (4, 9, 1, '2026-01-02', '2026-01-03')")
    migrate.migrate(conn, 4)
    assert conn.execute("SELECT id, email, status FROM members ORDER BY id").fetchall() == [
        (5, "a@x.io", "blocked"), (9, "b@x.io", "active")]
    assert conn.execute("SELECT id, member_id, book_id, loaned_at, returned_at FROM loans ORDER BY id").fetchall() == [
        (3, 5, 1, "2026-01-01", None), (4, 9, 1, "2026-01-02", "2026-01-03")]
    assert "name" not in cols(conn, "members")
    assert set(cols(conn, "members")) == {"id", "email", "status", "first_name", "last_name"}
    assert {r[2] for r in conn.execute("PRAGMA foreign_key_list(loans)")} == {"members", "books"}
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    assert tables(conn) == {"members", "books", "loans"}
    # ограничения пережили пересборку
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, first_name) VALUES ('a@x.io', 'X')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, first_name, status) VALUES ('z@x.io', 'X', 'gone')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, first_name) VALUES (NULL, 'X')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO members (email, last_name) VALUES ('q@x.io', 'X')")
    conn.execute("INSERT INTO members (email, first_name) VALUES ('z@x.io', 'Z')")
    assert conn.execute("SELECT status, last_name FROM members WHERE email='z@x.io'").fetchone() == ("active", "")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO loans (member_id, book_id, loaned_at) VALUES (4242, 1, '2026-01-01')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("DELETE FROM members WHERE id = 5")


def test_idempotent_rerun_changes_nothing(conn):
    migrate.migrate(conn)
    before = snapshot_schema(conn)
    assert migrate.migrate(conn) == []
    assert migrate.migrate(conn, 5) == []
    assert snapshot_schema(conn) == before


@pytest.mark.parametrize("bad", [-1, 6, 99, "3", 2.0, True, False])
def test_invalid_target(conn, bad):
    with pytest.raises(ValueError):
        migrate.migrate(conn, bad)
    assert migrate.current_version(conn) == 0


def test_downgrade_and_newer_db_rejected(conn):
    migrate.migrate(conn, 3)
    before = snapshot_schema(conn)
    with pytest.raises(migrate.MigrationError):
        migrate.migrate(conn, 1)
    assert migrate.current_version(conn) == 3
    conn.execute("PRAGMA user_version = 42")
    with pytest.raises(migrate.MigrationError):
        migrate.migrate(conn)
    assert migrate.current_version(conn) == 42
    assert snapshot_schema(conn) == before


def test_step_runs_in_transaction_with_fk_off_and_runner_restores(conn, monkeypatch):
    seen = {}

    def probe(c):
        seen["tx"] = c.in_transaction
        seen["fk"] = c.execute("PRAGMA foreign_keys").fetchone()[0]
        c.execute("CREATE TABLE probe (x INTEGER)")

    monkeypatch.setattr(migrate, "MIGRATIONS", list(migrate.MIGRATIONS) + [probe])
    assert migrate.migrate(conn) == [1, 2, 3, 4, 5, 6]
    assert seen == {"tx": True, "fk": 0}
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert not conn.in_transaction
    assert migrate.current_version(conn) == 6


def test_failure_in_real_step4_rolls_back_whole_step_and_resumes(conn, monkeypatch):
    original = list(migrate.MIGRATIONS)
    migrate.migrate(conn, 3)
    conn.execute("INSERT INTO members (id, email, name) VALUES (1, 'a@x.io', 'Anna Ivanova')")
    conn.execute("INSERT INTO books (id, isbn, title) VALUES (1, '1', 'T')")
    conn.execute("INSERT INTO loans (member_id, book_id, loaned_at) VALUES (1, 1, '2026-01-01')")
    before = snapshot_schema(conn)

    def failing(c):
        original[3](c)  # настоящий шаг 4 выполнился целиком...
        raise RuntimeError("после пересборки")  # ...и упал

    monkeypatch.setattr(migrate, "MIGRATIONS", original[:3] + [failing, original[4]])
    with pytest.raises(migrate.MigrationError) as e:
        migrate.migrate(conn)
    assert e.value.version == 4
    assert isinstance(e.value.__cause__, RuntimeError)
    assert migrate.current_version(conn) == 3
    assert snapshot_schema(conn) == before
    assert "name" in cols(conn, "members") and "first_name" not in cols(conn, "members")
    assert conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0] == 1
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert not conn.in_transaction
    monkeypatch.setattr(migrate, "MIGRATIONS", original)
    assert migrate.migrate(conn) == [4, 5]
    assert conn.execute("SELECT first_name, last_name FROM members").fetchall() == [("Anna", "Ivanova")]


def test_failure_keeps_earlier_steps(conn, monkeypatch):
    def broken(c):
        c.execute("CREATE TABLE tmp_x (a INTEGER)")
        c.execute("INSERT INTO nonexistent VALUES (1)")

    monkeypatch.setattr(migrate, "MIGRATIONS", migrate.MIGRATIONS[:1] + [broken] + migrate.MIGRATIONS[2:])
    with pytest.raises(migrate.MigrationError) as e:
        migrate.migrate(conn)
    assert e.value.version == 2
    assert isinstance(e.value.__cause__, sqlite3.OperationalError)
    assert migrate.current_version(conn) == 1
    assert tables(conn) == {"members", "books"}


def test_foreign_key_violation_left_by_step_is_rolled_back(conn, monkeypatch):
    migrate.migrate(conn, 3)
    conn.execute("INSERT INTO members (id, email, name) VALUES (1, 'a@x.io', 'A')")
    conn.execute("INSERT INTO books (id, isbn, title) VALUES (1, '1', 'T')")

    def orphan(c):
        c.execute("INSERT INTO loans (member_id, book_id, loaned_at) VALUES (777, 1, '2026-01-01')")

    monkeypatch.setattr(migrate, "MIGRATIONS", migrate.MIGRATIONS[:3] + [orphan])
    with pytest.raises(migrate.MigrationError) as e:
        migrate.migrate(conn)
    assert e.value.version == 4
    assert migrate.current_version(conn) == 3
    assert conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0] == 0
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_runner_reads_migrations_at_call_time(conn, monkeypatch):
    migrate.migrate(conn)
    monkeypatch.setattr(migrate, "MIGRATIONS", list(migrate.MIGRATIONS) + [lambda c: c.execute("CREATE TABLE extra (x)")])
    assert migrate.migrate(conn) == [6]
    assert "extra" in tables(conn)
    assert migrate.current_version(conn) == 6


def seed_loans(conn, n=600):
    migrate.migrate(conn, 4)
    for i in range(1, 21):
        conn.execute("INSERT INTO members (id, email, first_name) VALUES (?, ?, 'M')", (i, f"m{i}@x.io"))
        conn.execute("INSERT INTO books (id, isbn, title) VALUES (?, ?, 'T')", (i, str(i)))
    for i in range(n):
        conn.execute(
            "INSERT INTO loans (member_id, book_id, loaned_at, returned_at) VALUES (?,?,?,?)",
            (i % 20 + 1, (i * 7) % 20 + 1, f"2026-01-{i % 28 + 1:02d}", None if i % 3 else f"2026-03-{i % 28 + 1:02d}"),
        )


def test_indexes_serve_both_queries(conn):
    seed_loans(conn)
    for sql in (migrate.ACTIVE_LOANS_SQL, migrate.BOOK_LOANS_SQL):
        assert "SCAN loans" in plan(conn, sql)  # до версии 5 индексов под запросы нет
    migrate.migrate(conn, 5)
    for sql in (migrate.ACTIVE_LOANS_SQL, migrate.BOOK_LOANS_SQL):
        p = plan(conn, sql)
        assert "SCAN loans" not in p, p
        assert "USING INDEX" in p or "USING COVERING INDEX" in p, p


def test_query_functions_results(conn):
    migrate.migrate(conn)
    for i in (1, 2):
        conn.execute("INSERT INTO members (id, email, first_name) VALUES (?, ?, 'M')", (i, f"m{i}@x.io"))
        conn.execute("INSERT INTO books (id, isbn, title) VALUES (?, ?, 'T')", (i, str(i)))
    rows = [
        (1, 1, "2026-01-05", None), (1, 2, "2026-01-02", None), (1, 1, "2026-01-01", "2026-01-03"),
        (2, 1, "2026-01-02", None), (1, 2, "2026-01-02", None),
    ]
    for r in rows:
        conn.execute("INSERT INTO loans (member_id, book_id, loaned_at, returned_at) VALUES (?,?,?,?)", r)
    assert migrate.active_loans(conn, 1) == [(2, 2, "2026-01-02"), (5, 2, "2026-01-02"), (1, 1, "2026-01-05")]
    assert migrate.active_loans(conn, 2) == [(4, 1, "2026-01-02")]
    assert migrate.active_loans(conn, 77) == []
    assert migrate.book_loans(conn, 1) == [
        (1, 1, "2026-01-05", None), (4, 2, "2026-01-02", None), (3, 1, "2026-01-01", "2026-01-03")]


def test_concurrent_migrations_apply_each_version_once(tmp_path):
    path = str(tmp_path / "lib.db")
    n = 6
    barrier = threading.Barrier(n)
    results = [None] * n

    def run(i):
        c = migrate.connect(path)
        try:
            barrier.wait(timeout=20)
            results[i] = migrate.migrate(c)
        except BaseException as e:  # noqa: BLE001
            results[i] = e
        finally:
            c.close()

    ts = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(60)
    assert all(isinstance(r, list) for r in results), results
    assert sorted(v for r in results for v in r) == [1, 2, 3, 4, 5], results
    c = migrate.connect(path)
    assert migrate.current_version(c) == 5
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    c.close()


def test_file_db_survives_reconnect(tmp_path):
    path = str(tmp_path / "lib.db")
    c = migrate.connect(path)
    migrate.migrate(c, 3)
    c.execute("INSERT INTO members (email, name) VALUES ('a@x.io', 'Anna Ivanova')")
    c.close()
    c = migrate.connect(path)
    assert migrate.current_version(c) == 3
    assert migrate.migrate(c) == [4, 5]
    assert c.execute("SELECT first_name, last_name FROM members").fetchall() == [("Anna", "Ivanova")]
    c.close()
