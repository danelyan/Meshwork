# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import pytest

import metrics


def test_confusion_matrix_rows_are_truth():
    y_true = ["a", "a", "b", "b", "b"]
    y_pred = ["a", "b", "b", "b", "a"]
    assert metrics.confusion_matrix(y_true, y_pred) == [[1, 1], [1, 2]]


def test_report_per_class_and_macro():
    rep = metrics.classification_report([0, 0, 1, 1, 1], [0, 1, 1, 1, 0])
    assert rep["per_class"][1]["precision"] == pytest.approx(2 / 3)
    assert rep["per_class"][1]["recall"] == pytest.approx(2 / 3)
    assert rep["per_class"][0]["support"] == 2
    assert rep["accuracy"] == pytest.approx(3 / 5)


def test_roc_auc_basic():
    assert metrics.roc_auc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]) == pytest.approx(0.75)


def test_stratified_split_keeps_ratio_and_is_reproducible():
    labels = [0] * 8 + [1] * 4
    train, test = metrics.stratified_split(labels, test_size=0.25, seed=7)
    assert sorted(train + test) == list(range(12))
    assert sum(1 for i in test if labels[i] == 0) == 2 and sum(1 for i in test if labels[i] == 1) == 1
    assert (train, test) == metrics.stratified_split(labels, test_size=0.25, seed=7)
