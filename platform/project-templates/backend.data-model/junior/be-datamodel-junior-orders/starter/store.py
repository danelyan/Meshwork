"""Учёт заказов поверх SQLite по контракту (contract.md)."""
import sqlite3


class DataError(Exception):
    pass


class DuplicateError(DataError):
    pass


class NotFoundError(DataError):
    pass


class ValidationError(DataError):
    pass


class InUseError(DataError):
    pass


def connect(path=":memory:"):
    raise NotImplementedError("TODO")


def add_customer(conn, email, name):
    raise NotImplementedError("TODO")


def add_product(conn, sku, title, price_kop):
    raise NotImplementedError("TODO")


def create_order(conn, customer_id, items, created_at):
    raise NotImplementedError("TODO")


def order_total(conn, order_id):
    raise NotImplementedError("TODO")


def customer_report(conn):
    raise NotImplementedError("TODO")


def top_products(conn, limit=3):
    raise NotImplementedError("TODO")


def delete_customer(conn, customer_id):
    raise NotImplementedError("TODO")
