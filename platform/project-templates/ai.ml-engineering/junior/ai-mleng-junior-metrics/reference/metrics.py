"""Метрики классификации по контракту (эталон)."""
import math
import random


def _check_pair(y_true, y_pred):
    y_true, y_pred = list(y_true), list(y_pred)
    if not y_true or len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must be non-empty and of equal length")
    return y_true, y_pred


def _labels(y_true, y_pred, labels):
    if labels is None:
        return sorted(set(y_true) | set(y_pred))
    return list(labels)


def confusion_matrix(y_true, y_pred, labels=None):
    y_true, y_pred = _check_pair(y_true, y_pred)
    labels = _labels(y_true, y_pred, labels)
    pos = {lab: i for i, lab in enumerate(labels)}
    m = [[0] * len(labels) for _ in labels]
    for t, p in zip(y_true, y_pred):
        if t in pos and p in pos:
            m[pos[t]][pos[p]] += 1
    return m


def _prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"precision": float(p), "recall": float(r), "f1": float(f)}


def classification_report(y_true, y_pred, labels=None):
    y_true, y_pred = _check_pair(y_true, y_pred)
    labels = _labels(y_true, y_pred, labels)
    m = confusion_matrix(y_true, y_pred, labels)
    n = len(labels)
    total = sum(sum(row) for row in m)
    per_class, TP, FP, FN = {}, 0, 0, 0
    for i, lab in enumerate(labels):
        tp = m[i][i]
        fp = sum(m[k][i] for k in range(n)) - tp
        fn = sum(m[i]) - tp
        TP, FP, FN = TP + tp, FP + fp, FN + fn
        per_class[lab] = {**_prf(tp, fp, fn), "support": int(sum(m[i]))}
    macro = {k: float(sum(c[k] for c in per_class.values()) / n) if n else 0.0 for k in ("precision", "recall", "f1")}
    return {
        "labels": labels,
        "per_class": per_class,
        "macro": macro,
        "micro": _prf(TP, FP, FN),
        "accuracy": float(TP / total) if total else 0.0,
    }


def roc_auc(y_true, y_score):
    y_true, y_score = _check_pair(y_true, y_score)
    if any(t not in (0, 1) for t in y_true):
        raise ValueError("y_true must contain only 0 and 1")
    if any(isinstance(s, float) and math.isnan(s) for s in y_score) or any(s != s for s in y_score):
        raise ValueError("nan in y_score")
    pos = [float(s) for t, s in zip(y_true, y_score) if t == 1]
    neg = [float(s) for t, s in zip(y_true, y_score) if t == 0]
    if not pos or not neg:
        raise ValueError("both classes are required")
    wins = 0.0
    for a in pos:
        for b in neg:
            wins += 1.0 if a > b else 0.5 if a == b else 0.0
    return float(wins / (len(pos) * len(neg)))


def stratified_split(labels, test_size=0.25, seed=0):
    labels = list(labels)
    if not labels:
        raise ValueError("labels is empty")
    if not (0 < test_size < 1):
        raise ValueError("test_size must be in (0, 1)")
    groups = {}
    for i, lab in enumerate(labels):
        groups.setdefault(lab, []).append(i)
    rng = random.Random(seed)
    test = []
    for lab in sorted(groups):
        idx = groups[lab]
        n = len(idx)
        if n < 2:
            raise ValueError(f"class {lab!r} has fewer than 2 objects")
        k = min(max(int(n * test_size + 0.5), 1), n - 1)
        shuffled = list(idx)
        rng.shuffle(shuffled)
        test.extend(shuffled[:k])
    test_set = set(test)
    return [i for i in range(len(labels)) if i not in test_set], sorted(test)
