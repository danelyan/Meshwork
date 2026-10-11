"""Раннер миграций SQLite для учёта выдачи книг по контракту (contract.md)."""
import sqlite3


class MigrationError(Exception):
    def __init__(self, message, version=None):
        super().__init__(message)
        self.version = version


def _v1(conn):
    raise NotImplementedError("TODO")


def _v2(conn):
    raise NotImplementedError("TODO")


def _v3(conn):
    raise NotImplementedError("TODO")


def _v4(conn):
    raise NotImplementedError("TODO")


def _v5(conn):
    raise NotImplementedError("TODO")


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
    raise NotImplementedError("TODO")


def current_version(conn):
    raise NotImplementedError("TODO")


def migrate(conn, target=None):
    raise NotImplementedError("TODO")


def active_loans(conn, member_id):
    raise NotImplementedError("TODO")


def book_loans(conn, book_id):
    raise NotImplementedError("TODO")
