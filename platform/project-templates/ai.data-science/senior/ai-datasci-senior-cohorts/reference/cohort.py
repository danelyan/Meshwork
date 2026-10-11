"""Когорты, LTV и CUPED по контракту (contract.md)."""
import math
from statistics import NormalDist

import numpy as np
import pandas as pd

_N = NormalDist()


def _p_two_sided(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2))


def _check_columns(users: pd.DataFrame, orders: pd.DataFrame, need_group: bool) -> None:
    ucols = ["user_id", "signup_date"] + (["group"] if need_group else [])
    for col in ucols:
        if col not in users.columns:
            raise ValueError(f"missing column: {col}")
    for col in ["user_id", "order_date", "amount"]:
        if col not in orders.columns:
            raise ValueError(f"missing column: {col}")


def _prepare(users: pd.DataFrame, orders: pd.DataFrame, need_group: bool):
    _check_columns(users, orders, need_group)
    if users["user_id"].duplicated().any():
        raise ValueError("duplicate user_id")
    try:
        signup = pd.to_datetime(users["signup_date"], format="ISO8601").dt.normalize()
        odate = pd.to_datetime(orders["order_date"], format="ISO8601").dt.normalize()
    except (ValueError, TypeError):
        raise ValueError("bad date")
    if signup.isna().any() or odate.isna().any():
        raise ValueError("bad date")
    amount = pd.to_numeric(orders["amount"], errors="coerce")
    if amount.isna().any() or (amount < 0).any():
        raise ValueError("bad amount")
    if need_group and not users["group"].isin(["control", "treatment"]).all():
        raise ValueError("bad group")
    u = pd.DataFrame({"user_id": users["user_id"].to_numpy(), "signup": signup.to_numpy()})
    if need_group:
        u["group"] = users["group"].to_numpy()
    o = pd.DataFrame({"user_id": orders["user_id"].to_numpy(), "date": odate.to_numpy(),
                      "amount": amount.astype(float).to_numpy()})
    return u, o


def _month_index(s: pd.Series) -> pd.Series:
    return s.dt.year * 12 + s.dt.month


def build_cohorts(users: pd.DataFrame, orders: pd.DataFrame, as_of: str, horizon: int = 3) -> pd.DataFrame:
    if isinstance(horizon, bool) or not isinstance(horizon, (int, np.integer)) or horizon < 0:
        raise ValueError("bad horizon")
    u, o = _prepare(users, orders, False)
    try:
        as_of_ts = pd.Timestamp(as_of).normalize()
    except (ValueError, TypeError):
        raise ValueError("bad date")
    cols = ["cohort", "size"] + [f"retention_{k}" for k in range(horizon + 1)] + [f"ltv_{k}" for k in range(horizon + 1)]
    u = u[u["signup"] <= as_of_ts].copy()
    if u.empty:
        return pd.DataFrame(columns=cols)
    u["cmonth"] = _month_index(u["signup"])
    as_of_m = as_of_ts.year * 12 + as_of_ts.month
    j = o.merge(u[["user_id", "signup", "cmonth"]], on="user_id", how="inner")
    j = j[(j["date"] >= j["signup"]) & (j["date"] <= as_of_ts)]
    j["k"] = _month_index(j["date"]) - j["cmonth"]
    j = j[j["k"] <= horizon]
    sizes = u.groupby("cmonth").size()
    rows = []
    for cm, size in sizes.items():
        sub = j[j["cmonth"] == cm]
        ret, ltv, cum = [], [], 0.0
        for k in range(horizon + 1):
            s = sub[sub["k"] == k]
            cum += float(s["amount"].sum())
            if cm + k > as_of_m:
                ret.append(float("nan"))
                ltv.append(float("nan"))
            else:
                ret.append(s["user_id"].nunique() / size)
                ltv.append(cum / size)
        rows.append([f"{(cm - 1) // 12:04d}-{(cm - 1) % 12 + 1:02d}", int(size)] + ret + ltv)
    return pd.DataFrame(rows, columns=cols)


def cuped_adjust(y, x) -> dict:
    try:
        ya = np.asarray(y, dtype=float)
        xa = np.asarray(x, dtype=float)
    except (ValueError, TypeError):
        raise ValueError("bad input")
    if ya.ndim != 1 or xa.ndim != 1 or ya.size != xa.size or ya.size < 1 \
            or not np.isfinite(ya).all() or not np.isfinite(xa).all():
        raise ValueError("bad input")
    dx = xa - xa.mean()
    den = float((dx * dx).sum())
    theta = float((dx * (ya - ya.mean())).sum() / den) if den > 0 else 0.0
    adj = ya - theta * dx
    vy = _var(ya)
    vr = 1.0 - _var(adj) / vy if vy > 0 else 0.0
    return {"theta": theta, "adjusted": adj, "variance_reduction": float(vr)}


def _var(a: np.ndarray) -> float:
    return float(np.var(a, ddof=1)) if a.size > 1 else 0.0


def _compare(c: np.ndarray, t: np.ndarray, alpha: float) -> dict:
    zc = _N.inv_cdf(1 - alpha / 2)
    diff = float(t.mean() - c.mean())
    se = math.sqrt(_var(c) / c.size + _var(t) / t.size)
    z, p = (diff / se, _p_two_sided(diff / se)) if se > 0 else (0.0, 1.0)
    return {"mean_control": float(c.mean()), "mean_treatment": float(t.mean()), "diff": diff, "se": se,
            "ci_low": diff - zc * se, "ci_high": diff + zc * se, "z": z, "p_value": p, "significant": p < alpha}


def ab_ltv(users: pd.DataFrame, orders: pd.DataFrame, exp_start: str,
           pre_days: int = 30, post_days: int = 30, alpha: float = 0.05) -> dict:
    for v in (pre_days, post_days):
        if isinstance(v, bool) or not isinstance(v, (int, np.integer)) or v < 1:
            raise ValueError("bad window")
    u, o = _prepare(users, orders, True)
    try:
        start = pd.Timestamp(exp_start).normalize()
    except (ValueError, TypeError):
        raise ValueError("bad date")
    pre_from = start - pd.Timedelta(days=pre_days)
    post_to = start + pd.Timedelta(days=post_days)
    o = o[o["user_id"].isin(set(u["user_id"]))]
    pre = o[(o["date"] >= pre_from) & (o["date"] < start)].groupby("user_id")["amount"].sum()
    post = o[(o["date"] >= start) & (o["date"] < post_to)].groupby("user_id")["amount"].sum()
    x = u["user_id"].map(pre).fillna(0.0).to_numpy(dtype=float)
    y = u["user_id"].map(post).fillna(0.0).to_numpy(dtype=float)
    is_c = (u["group"] == "control").to_numpy()
    if is_c.all() or (~is_c).all():
        raise ValueError("empty group")
    cu = cuped_adjust(y, x)
    adj = cu["adjusted"]
    return {"n": {"control": int(is_c.sum()), "treatment": int((~is_c).sum())},
            "raw": _compare(y[is_c], y[~is_c], alpha),
            "cuped": _compare(adj[is_c], adj[~is_c], alpha),
            "theta": cu["theta"], "variance_reduction": cu["variance_reduction"]}
