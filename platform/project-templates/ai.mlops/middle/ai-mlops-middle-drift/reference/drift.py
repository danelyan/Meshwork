"""Мониторинг дрейфа (эталон)."""
import math
from collections import Counter

ORDER = {"ok": 0, "warn": 1, "alert": 2}
DEFAULTS = {"psi_warn": 0.1, "psi_alert": 0.25, "ks_warn": 0.1, "ks_alert": 0.2, "bins": 10}


def _clean(values):
    out = []
    for v in values:
        if v is None:
            continue
        if isinstance(v, float) and math.isnan(v):
            continue
        out.append(v.item() if hasattr(v, "item") else v)
    return out


def _check_eps(eps):
    if not eps > 0:
        raise ValueError("eps")


def _term(e, a, eps):
    e = max(e, eps)
    a = max(a, eps)
    return (a - e) * math.log(a / e)


def psi(expected, actual, bins=10, eps=1e-4):
    if bins < 1:
        raise ValueError("bins")
    _check_eps(eps)
    exp, act = _clean(expected), _clean(actual)
    if not exp or not act:
        raise ValueError("пустая выборка")
    lo, hi = min(exp), max(exp)

    def counts(xs):
        c = [0] * bins
        for x in xs:
            if hi == lo:
                i = 0
            else:
                i = int((x - lo) / (hi - lo) * bins)
                i = min(bins - 1, max(0, i))
            c[i] += 1
        return c

    ce, ca = counts(exp), counts(act)
    return sum(_term(x / len(exp), y / len(act), eps) for x, y in zip(ce, ca))


def psi_categorical(expected, actual, eps=1e-4):
    _check_eps(eps)
    exp, act = _clean(expected), _clean(actual)
    if not exp or not act:
        raise ValueError("пустая выборка")
    ce, ca = Counter(exp), Counter(act)
    total = 0.0
    for cat in set(ce) | set(ca):
        total += _term(ce.get(cat, 0) / len(exp), ca.get(cat, 0) / len(act), eps)
    return total


def ks_statistic(a, b):
    xa, xb = sorted(_clean(a)), sorted(_clean(b))
    if not xa or not xb:
        raise ValueError("пустая выборка")
    i = j = 0
    d = 0.0
    for v in sorted(set(xa) | set(xb)):
        while i < len(xa) and xa[i] <= v:
            i += 1
        while j < len(xb) and xb[j] <= v:
            j += 1
        d = max(d, abs(i / len(xa) - j / len(xb)))
    return d


def severity(value, warn, alert):
    if warn > alert:
        raise ValueError("warn > alert")
    if value >= alert:
        return "alert"
    if value >= warn:
        return "warn"
    return "ok"


def _is_numeric(values):
    return all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values)


def _worst(statuses):
    return max(statuses, key=lambda s: ORDER[s]) if statuses else "no_data"


def drift_report(reference, windows, thresholds=None):
    th = dict(DEFAULTS)
    for k, v in (thresholds or {}).items():
        if k not in DEFAULTS:
            raise ValueError(f"неизвестный порог {k}")
        th[k] = v
    ref = {}
    for feat, values in reference.items():
        clean = _clean(values)
        if not clean:
            raise ValueError(f"пустой эталон: {feat}")
        ref[feat] = (clean, _is_numeric(clean))
    for w in windows:
        if not isinstance(w, dict) or "name" not in w or "data" not in w:
            raise ValueError("окно без name/data")
    out = []
    for w in windows:
        feats = {}
        for feat, (clean, numeric) in ref.items():
            act = _clean(w["data"][feat]) if feat in w["data"] else []
            if not act:
                feats[feat] = {"type": "numeric" if numeric else "categorical", "psi": None, "ks": None, "status": "no_data"}
                continue
            if numeric:
                p = psi(clean, act, bins=th["bins"])
                k = ks_statistic(clean, act)
                status = _worst([severity(p, th["psi_warn"], th["psi_alert"]), severity(k, th["ks_warn"], th["ks_alert"])])
                feats[feat] = {"type": "numeric", "psi": p, "ks": k, "status": status}
            else:
                p = psi_categorical(clean, act)
                feats[feat] = {"type": "categorical", "psi": p, "ks": None,
                               "status": severity(p, th["psi_warn"], th["psi_alert"])}
        statuses = [f["status"] for f in feats.values() if f["status"] != "no_data"]
        out.append({"window": w["name"], "status": _worst(statuses), "features": feats})
    alerts = [w["window"] for w in out if w["status"] == "alert"]
    return {"windows": out, "summary": {"alert_windows": alerts, "first_alert": alerts[0] if alerts else None}}
