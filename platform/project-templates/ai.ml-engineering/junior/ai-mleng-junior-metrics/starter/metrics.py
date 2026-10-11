"""Метрики классификации по контракту (contract.md)."""


def confusion_matrix(y_true, y_pred, labels=None):
    raise NotImplementedError("TODO")


def classification_report(y_true, y_pred, labels=None):
    raise NotImplementedError("TODO")


def roc_auc(y_true, y_score):
    raise NotImplementedError("TODO")


def stratified_split(labels, test_size=0.25, seed=0):
    raise NotImplementedError("TODO")
