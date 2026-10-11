"""Раннер миграций SQLite для учёта выдачи книг по контракту (contract.md)."""
import sqlite3


class MigrationError(Exception):
    def __init__(self, message, version=None):
        super().__init__(message)
        self.version = version


def _v1(conn):
    conn.execute("CREATE TABLE members (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL)")
    conn.execute("CREATE TABLE books (id INTEGER PRIMARY KEY, isbn TEXT NOT NULL UNIQUE, title TEXT NOT NULL)")


def _v2(conn):
    conn.execute(
        """CREATE TABLE loans (
            id INTEGER PRIMARY KEY,
            member_id INTEGER NOT NULL REFERENCES members(id),
            book_id INTEGER NOT NULL REFERENCES books(id),
            loaned_at TEXT NOT NULL,
            returned_at TEXT,
            CHECK (returned_at IS NULL OR returned_at >= loaned_at)
        )"""
    )


def _v3(conn):
    conn.execute(
        "ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'active' "
        "CHECK (status IN ('active', 'blocked'))"
    )


def _v4(conn):
    # Пересборка по рецепту SQLite: новая таблица -> копия -> DROP -> RENAME. Внешние ключи выключает раннер.
    conn.execute(
        """CREATE TABLE members_new (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL DEFAULT ''
        )"""
    )
    for mid, email, name, status in conn.execute("SELECT id, email, name, status FROM members").fetchall():
        parts = name.strip().split(None, 1)
        first = parts[0] if parts else ""
        last = parts[1].strip() if len(parts) > 1 else ""
        conn.execute(
            "INSERT INTO members_new (id, email, status, first_name, last_name) VALUES (?,?,?,?,?)",
            (mid, email, status, first, last),
        )
    conn.execute("DROP TABLE members")
    conn.execute("ALTER TABLE members_new RENAME TO members")


def _v5(conn):
    conn.execute("CREATE INDEX loans_member_active ON loans (member_id, returned_at)")
    conn.execute("CREATE INDEX loans_book ON loans (book_id, loaned_at)")


MIGRATIONS = [_v1, _v2, _v3, _v4, _v5]

ACTIVE_LOANS_SQL = (
    "SELECT id, book_id, loaned_at FROM loans WHERE member_id = ? AND returned_at IS NULL "
    "ORDER BY loaned_at, id"
)
BOOK_LOANS_SQL = (
    "SELECT id, member_id, loaned_at, returned_at FROM loans WHERE book_id = ? "
    "ORDER BY loaned_at DESC, id DESC"
)


def connect(path=":memory:"):
    conn = sqlite3.connect(path, timeout=30, isolation_level=None, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def current_version(conn):
    return conn.execute("PRAGMA user_version").fetchone()[0]


def _apply(conn, version, step):
    """Один шаг в своей транзакции. True – применён, False – уже применён другим."""
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            if current_version(conn) >= version:  # перечитали под замком записи
                conn.execute("ROLLBACK")
                return False
            step(conn)
            violations = conn.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise MigrationError(f"нарушены внешние ключи: {len(violations)}")
            conn.execute(f"PRAGMA user_version = {int(version)}")
            conn.execute("COMMIT")
            return True
        except BaseException as e:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            if isinstance(e, MigrationError):
                e.version = version
                raise
            if isinstance(e, Exception):
                raise MigrationError(f"шаг {version}: {e}", version) from e
            raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


def migrate(conn, target=None):
    steps = MIGRATIONS
    latest = len(steps)
    if target is None:
        target = latest
    if not isinstance(target, int) or isinstance(target, bool) or target < 0 or target > latest:
        raise ValueError(f"target: целое от 0 до {latest}")
    cur = current_version(conn)
    if cur > latest:
        raise MigrationError(f"база новее кода: {cur} > {latest}")
    if target < cur:
        raise MigrationError(f"понижение версии не поддерживается: {cur} -> {target}")
    applied = []
    for version in range(cur + 1, target + 1):
        if _apply(conn, version, steps[version - 1]):
            applied.append(version)
    return applied


def active_loans(conn, member_id):
    return conn.execute(ACTIVE_LOANS_SQL, (member_id,)).fetchall()


def book_loans(conn, book_id):
    return conn.execute(BOOK_LOANS_SQL, (book_id,)).fetchall()
