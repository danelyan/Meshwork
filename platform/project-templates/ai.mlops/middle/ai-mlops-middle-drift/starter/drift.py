"""Мониторинг дрейфа по контракту (contract.md)."""


def psi(expected, actual, bins=10, eps=1e-4):
    raise NotImplementedError("TODO")


def psi_categorical(expected, actual, eps=1e-4):
    raise NotImplementedError("TODO")


def ks_statistic(a, b):
    raise NotImplementedError("TODO")


def severity(value, warn, alert):
    raise NotImplementedError("TODO")


def drift_report(reference, windows, thresholds=None):
    raise NotImplementedError("TODO")
