"""Версионируемый каталог с аудитом поверх SQLite по контракту (contract.md)."""
import sqlite3
import time


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


def connect(path=":memory:", clock=None):
    raise NotImplementedError("TODO")


def create(conn, key, title, price_kop, actor):
    raise NotImplementedError("TODO")


def update(conn, key, changes, expected_version, actor):
    raise NotImplementedError("TODO")


def delete(conn, key, expected_version, actor):
    raise NotImplementedError("TODO")


def restore(conn, key, expected_version, actor):
    raise NotImplementedError("TODO")


def revert(conn, key, to_version, expected_version, actor):
    raise NotImplementedError("TODO")


def get(conn, key, include_deleted=False):
    raise NotImplementedError("TODO")


def list_active(conn):
    raise NotImplementedError("TODO")


def history(conn, key):
    raise NotImplementedError("TODO")


def as_of(conn, key, at):
    raise NotImplementedError("TODO")


def snapshot(conn, at):
    raise NotImplementedError("TODO")
