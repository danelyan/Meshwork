# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import numpy as np
import pytest

import metrics


def test_confusion_matrix_explicit_labels_order_and_ignored_pairs():
    y_true = ["cat", "dog", "cat", "bird"]
    y_pred = ["dog", "dog", "cat", "cat"]
    # bird не входит в labels: пары с ним не учитываются
    assert metrics.confusion_matrix(y_true, y_pred, labels=["dog", "cat"]) == [[1, 0], [1, 1]]


def test_confusion_matrix_default_labels_union_and_numpy_input():
    m = metrics.confusion_matrix(np.array([0, 1, 2, 2]), np.array([0, 1, 1, 3]))
    assert m == [[1, 0, 0, 0], [0, 1, 0, 0], [0, 1, 0, 1], [0, 0, 0, 0]]
    assert all(type(v) is int for row in m for v in row)


def test_confusion_matrix_validation():
    with pytest.raises(ValueError):
        metrics.confusion_matrix([], [])
    with pytest.raises(ValueError):
        metrics.confusion_matrix([0, 1], [0])


def test_report_three_classes_values():
    y_true = [0, 0, 0, 1, 1, 2, 2, 2, 2]
    y_pred = [0, 0, 1, 1, 2, 2, 2, 2, 0]
    rep = metrics.classification_report(y_true, y_pred)
    assert rep["labels"] == [0, 1, 2]
    c0, c1, c2 = (rep["per_class"][k] for k in (0, 1, 2))
    assert c0["precision"] == pytest.approx(2 / 3) and c0["recall"] == pytest.approx(2 / 3)
    assert c1["precision"] == pytest.approx(1 / 2) and c1["recall"] == pytest.approx(1 / 2)
    assert c2["precision"] == pytest.approx(3 / 4) and c2["recall"] == pytest.approx(3 / 4)
    assert (c0["support"], c1["support"], c2["support"]) == (3, 2, 4)
    assert rep["accuracy"] == pytest.approx(6 / 9)


def test_report_macro_is_mean_of_class_f1_and_micro_is_pooled():
    y_true = [0, 0, 0, 0, 1, 1, 2]
    y_pred = [0, 0, 0, 1, 1, 0, 0]
    rep = metrics.classification_report(y_true, y_pred)
    f1s = [rep["per_class"][k]["f1"] for k in (0, 1, 2)]
    assert rep["macro"]["f1"] == pytest.approx(sum(f1s) / 3)
    p_macro = sum(rep["per_class"][k]["precision"] for k in (0, 1, 2)) / 3
    assert rep["macro"]["precision"] == pytest.approx(p_macro)
    # одно-метка-на-объект и все классы учтены: micro = accuracy
    assert rep["micro"]["precision"] == pytest.approx(4 / 7)
    assert rep["micro"]["recall"] == pytest.approx(4 / 7)
    assert rep["micro"]["f1"] == pytest.approx(4 / 7)
    assert rep["accuracy"] == pytest.approx(4 / 7)


def test_report_zero_division_gives_zero_not_nan():
    # класс 2 никогда не предсказан (precision 0/0), класс 3 никогда не встречается в истине (recall 0/0)
    rep = metrics.classification_report([0, 1, 2], [0, 1, 3])
    assert rep["per_class"][2]["precision"] == 0.0 and rep["per_class"][2]["f1"] == 0.0
    assert rep["per_class"][3]["recall"] == 0.0 and rep["per_class"][3]["support"] == 0
    for block in (rep["macro"], rep["micro"]):
        assert all(isinstance(v, float) and v == v for v in block.values())


def test_report_explicit_labels_subset_changes_micro_and_macro():
    y_true = [0, 0, 1, 1, 2]
    y_pred = [0, 1, 1, 1, 0]
    rep = metrics.classification_report(y_true, y_pred, labels=[0, 1])
    assert rep["labels"] == [0, 1]
    assert set(rep["per_class"]) == {0, 1}
    # учтены пары, где обе метки в labels: (0,0), (0,1), (1,1), (1,1)
    assert rep["accuracy"] == pytest.approx(3 / 4)
    assert rep["micro"]["precision"] == pytest.approx(3 / 4)
    assert rep["per_class"][0]["support"] == 2


def test_report_string_labels():
    rep = metrics.classification_report(["spam", "ham", "ham", "spam"], ["spam", "ham", "spam", "spam"])
    assert rep["per_class"]["spam"]["precision"] == pytest.approx(2 / 3)
    assert rep["per_class"]["ham"]["recall"] == pytest.approx(1 / 2)


def test_roc_auc_ties_count_half():
    assert metrics.roc_auc([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]) == pytest.approx(0.5)
    assert metrics.roc_auc([1, 0, 1, 0], [0.9, 0.9, 0.8, 0.1]) == pytest.approx((0.5 + 1 + 0 + 1) / 4)


def test_roc_auc_perfect_inverted_and_bool():
    assert metrics.roc_auc([False, False, True, True], [1, 2, 3, 4]) == pytest.approx(1.0)
    assert metrics.roc_auc([0, 0, 1, 1], [4, 3, 2, 1]) == pytest.approx(0.0)


def test_roc_auc_matches_bruteforce_on_random_data():
    rng = np.random.default_rng(42)
    y = rng.integers(0, 2, 200)
    s = np.round(rng.normal(size=200) + y * 0.8, 1)  # округление даёт много ничьих
    pos, neg = s[y == 1], s[y == 0]
    expected = np.mean([(a > b) + 0.5 * (a == b) for a in pos for b in neg])
    assert metrics.roc_auc(y, s) == pytest.approx(expected)


def test_roc_auc_validation():
    with pytest.raises(ValueError):
        metrics.roc_auc([1, 1, 1], [0.1, 0.2, 0.3])
    with pytest.raises(ValueError):
        metrics.roc_auc([0, 1, 2], [0.1, 0.2, 0.3])
    with pytest.raises(ValueError):
        metrics.roc_auc([0, 1], [0.1])
    with pytest.raises(ValueError):
        metrics.roc_auc([0, 1], [0.1, float("nan")])


def test_split_sizes_per_class_and_cover():
    labels = ["a"] * 20 + ["b"] * 10 + ["c"] * 3
    train, test = metrics.stratified_split(labels, test_size=0.3, seed=1)
    assert sorted(train + test) == list(range(33))
    assert not set(train) & set(test)
    assert train == sorted(train) and test == sorted(test)
    count = lambda lab: sum(1 for i in test if labels[i] == lab)
    assert (count("a"), count("b"), count("c")) == (6, 3, 1)


def test_split_bounds_at_least_one_each_side():
    labels = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1]
    train, test = metrics.stratified_split(labels, test_size=0.01, seed=0)
    assert sum(1 for i in test if labels[i] == 0) == 1 and sum(1 for i in test if labels[i] == 1) == 1
    train, test = metrics.stratified_split(labels, test_size=0.99, seed=0)
    assert sum(1 for i in train if labels[i] == 0) == 1 and sum(1 for i in train if labels[i] == 1) == 1


def test_split_deterministic_seed_dependent_and_no_side_effects():
    import random

    labels = [i % 3 for i in range(60)]
    original = list(labels)
    random.seed(5)
    state = random.getstate()
    a = metrics.stratified_split(labels, 0.25, seed=3)
    assert random.getstate() == state  # глобальный random не тронут
    assert labels == original
    assert a == metrics.stratified_split(np.array(labels), 0.25, seed=3)
    others = {tuple(metrics.stratified_split(labels, 0.25, seed=s)[1]) for s in range(5)}
    assert len(others) > 1


def test_split_validation():
    for bad in (0, 1, -0.1, 1.5):
        with pytest.raises(ValueError):
            metrics.stratified_split([0, 0, 1, 1], test_size=bad)
    with pytest.raises(ValueError):
        metrics.stratified_split([])
    with pytest.raises(ValueError):
        metrics.stratified_split([0, 0, 0, 1])
