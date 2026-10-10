"""Инкрементальная агрегация платежей по контракту (contract.md)."""
from datetime import timedelta


def process_batch(state, events, allowed_lateness=timedelta(hours=2)):
    raise NotImplementedError("TODO")


def report(state):
    raise NotImplementedError("TODO")


def seen_count(state):
    raise NotImplementedError("TODO")
