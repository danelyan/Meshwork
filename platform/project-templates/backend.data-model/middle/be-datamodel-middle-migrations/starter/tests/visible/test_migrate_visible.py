# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pytest

import migrate


@pytest.fixture
def conn():
    c = migrate.connect()
    yield c
    c.close()


def cols(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def test_migrate_from_empty_to_latest(conn):
    assert migrate.current_version(conn) == 0
    assert migrate.migrate(conn) == [1, 2, 3, 4, 5]
    assert migrate.current_version(conn) == 5
    assert migrate.migrate(conn) == []
    assert "first_name" in cols(conn, "members") and "name" not in cols(conn, "members")


def test_name_split_keeps_loans_and_ids(conn):
    migrate.migrate(conn, 3)
    conn.execute("INSERT INTO members (id, email, name) VALUES (7, 'a@x.io', 'Jean Claude Van Damme')")
    conn.execute("INSERT INTO books (id, isbn, title) VALUES (1, '111', 'T')")
    conn.execute("INSERT INTO loans (member_id, book_id, loaned_at) VALUES (7, 1, '2026-01-01')")
    assert migrate.migrate(conn) == [4, 5]
    assert conn.execute("SELECT id, first_name, last_name, status FROM members").fetchall() == [
        (7, "Jean", "Claude Van Damme", "active")
    ]
    assert conn.execute("SELECT COUNT(*) FROM loans").fetchone()[0] == 1
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_failed_step_is_rolled_back(conn, monkeypatch):
    def broken(c):
        c.execute("CREATE TABLE half_done (x INTEGER)")
        raise RuntimeError("boom")

    monkeypatch.setattr(migrate, "MIGRATIONS", migrate.MIGRATIONS[:2] + [broken])
    with pytest.raises(migrate.MigrationError) as e:
        migrate.migrate(conn)
    assert e.value.version == 3
    assert migrate.current_version(conn) == 2
    assert "half_done" not in {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_latest_schema_uses_indexes_for_loan_queries(conn):
    migrate.migrate(conn)
    plan = lambda sql: " | ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + sql, (1,)))
    for sql in (migrate.ACTIVE_LOANS_SQL, migrate.BOOK_LOANS_SQL):
        p = plan(sql)
        assert "INDEX" in p and "SCAN loans" not in p
