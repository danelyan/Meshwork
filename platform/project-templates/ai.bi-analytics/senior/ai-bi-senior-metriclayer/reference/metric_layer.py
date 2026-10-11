"""Слой метрик по контракту (contract.md)."""
import math

import pandas as pd

NONE = "(none)"
BASE_TYPES = ("sum", "count", "count_distinct")


def _listify(v) -> list:
    return list(v) if isinstance(v, (list, tuple, set, frozenset)) else [v]


class MetricLayer:
    def __init__(self, definitions: dict, tables: dict) -> None:
        self._defs = {k: dict(v) if isinstance(v, dict) else v for k, v in definitions.items()}
        self._tables = {k: v.copy() for k, v in tables.items()}
        for name, d in self._defs.items():
            if not isinstance(d, dict):
                raise ValueError(f"bad type: {name}")
            t = d.get("type")
            if t == "ratio":
                if "numerator" not in d or "denominator" not in d:
                    raise ValueError(f"bad type: {name}")
                continue
            if t not in BASE_TYPES or (t != "count" and not d.get("column")):
                raise ValueError(f"bad type: {name}")
            table = d.get("table")
            if table not in self._tables:
                raise ValueError(f"unknown table: {table}")
            cols = self._tables[table].columns
            checks = [d["column"]] if t != "count" else []
            if d.get("time") is not None:
                checks.append(d["time"])
            checks += list((d.get("filter") or {}).keys())
            for c in checks:
                if c not in cols:
                    raise ValueError(f"unknown column: {table}.{c}")
        for d in self._defs.values():
            if d["type"] == "ratio":
                for ref in (d["numerator"], d["denominator"]):
                    if ref not in self._defs:
                        raise ValueError(f"unknown metric: {ref}")
        for name, d in self._defs.items():
            if d["type"] == "ratio" and self._reaches(name, name):
                raise ValueError(f"cyclic definition: {name}")

    def _reaches(self, start: str, target: str) -> bool:
        seen: set[str] = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            d = self._defs[cur]
            if d["type"] != "ratio":
                continue
            for ref in (d["numerator"], d["denominator"]):
                if ref == target:
                    return True
                if ref not in seen:
                    seen.add(ref)
                    stack.append(ref)
        return False

    def _leaves(self, name: str) -> list[str]:
        d = self._defs[name]
        if d["type"] != "ratio":
            return [name]
        return self._leaves(d["numerator"]) + self._leaves(d["denominator"])

    def _dim_values(self, df: pd.DataFrame, d: dict, dim: str) -> pd.Series:
        if dim in df.columns:
            s = df[dim]
            return s.where(s.notna(), NONE).astype(str)
        if dim == "month" and d.get("time") is not None:
            col = df[d["time"]]
            ts = col if pd.api.types.is_datetime64_any_dtype(col) else pd.to_datetime(col, format="ISO8601", errors="coerce")
            return ts.dt.strftime("%Y-%m").fillna(NONE).astype(str)
        raise ValueError(f"unknown dimension: {dim}")

    def _check_dims(self, name: str, dims) -> None:
        for dim in dims:
            for leaf in self._leaves(name):
                d = self._defs[leaf]
                if dim not in self._tables[d["table"]].columns and not (dim == "month" and d.get("time") is not None):
                    raise ValueError(f"unknown dimension: {dim}")

    def _base(self, name: str, by: list[str], filters: dict) -> pd.DataFrame:
        d = self._defs[name]
        df = self._tables[d["table"]]
        mask = pd.Series(True, index=df.index)
        for col, v in (d.get("filter") or {}).items():
            mask &= df[col].isin(_listify(v))
        df = df[mask]
        need = list(dict.fromkeys([*by, *filters]))
        dims = pd.DataFrame({k: self._dim_values(df, d, k) for k in need}, index=df.index)
        for k, v in filters.items():
            keep = dims[k].isin({str(x) for x in _listify(v)})
            df, dims = df[keep], dims[keep]
        if d["type"] == "sum":
            vals = pd.to_numeric(df[d["column"]], errors="coerce")
            agg = "sum"
        elif d["type"] == "count":
            vals = pd.Series(1, index=df.index)
            agg = "sum"
        else:
            vals = df[d["column"]]
            agg = "nunique"
        if not by:
            if agg == "nunique":
                v = float(vals.dropna().nunique())
            else:
                v = float(vals.sum()) if len(vals) else 0.0
            return pd.DataFrame({"v": [v]})
        g = dims[by].copy()
        g["v"] = vals
        out = g.groupby(by, sort=False)["v"].agg(agg).reset_index()
        out["v"] = out["v"].astype("float64")
        return out

    def _eval(self, name: str, by: list[str], filters: dict) -> pd.DataFrame:
        d = self._defs[name]
        if d["type"] != "ratio":
            return self._base(name, by, filters)
        n = self._eval(d["numerator"], by, filters)
        m = self._eval(d["denominator"], by, filters)
        if not by:
            den = m["v"].iloc[0]
            return pd.DataFrame({"v": [n["v"].iloc[0] / den if den else math.nan]})
        j = n.merge(m, on=by, how="outer", suffixes=("_n", "_d")).fillna({"v_n": 0.0, "v_d": 0.0})
        den = j["v_d"].where(j["v_d"] != 0)
        j["v"] = j["v_n"] / den
        return j[[*by, "v"]]

    def _prepare(self, metric: str, by, filters):
        if metric not in self._defs:
            raise ValueError(f"unknown metric: {metric}")
        by = list(by)
        if len(set(by)) != len(by):
            raise ValueError("bad by")
        filters = dict(filters or {})
        self._check_dims(metric, [*by, *filters])
        return by, filters

    def query(self, metric: str, by=(), filters: dict | None = None) -> pd.DataFrame:
        by, filters = self._prepare(metric, by, filters)
        raw = self._eval(metric, by, filters)
        t = self._defs[metric]["type"]
        v = raw["v"]
        if t == "sum":
            v = v.round(2).astype("float64")
        elif t == "ratio":
            v = v.round(4).astype("float64")
        else:
            v = v.astype("int64")
        out = raw[by].copy() if by else pd.DataFrame(index=raw.index)
        out[metric] = v
        if by:
            out = out.sort_values(by, kind="mergesort")
        return out.reset_index(drop=True)

    def reconcile(self, metric: str, by) -> dict:
        by, _ = self._prepare(metric, by, None)
        t = self._defs[metric]["type"]
        total_raw = float(self._eval(metric, [], {})["v"].iloc[0])
        digits = 4 if t == "ratio" else 2
        cast = (lambda x: x) if t in ("sum", "ratio") else int
        base = {"metric": metric, "total": cast(round(total_raw, digits))}
        if t == "ratio":
            return {**base, "grouped_sum": None, "diff": None, "additive": False, "consistent": None}
        grouped_raw = float(self._eval(metric, by, {})["v"].sum()) if by else total_raw
        diff = total_raw - grouped_raw
        return {**base, "grouped_sum": cast(round(grouped_raw, digits)), "diff": round(diff, 4),
                "additive": t in ("sum", "count"), "consistent": abs(diff) < 1e-9}


def find_duplicates(definitions: dict) -> list[list[str]]:
    groups: dict[tuple, list[str]] = {}
    for name, d in definitions.items():
        if d["type"] == "ratio":
            key: tuple = ("ratio", d["numerator"], d["denominator"])
        else:
            flt = tuple(sorted((c, tuple(sorted(_listify(v), key=repr))) for c, v in (d.get("filter") or {}).items()))
            key = (d["type"], d["table"], None if d["type"] == "count" else d["column"], d.get("time"), flt)
        groups.setdefault(key, []).append(name)
    res = [sorted(v) for v in groups.values() if len(v) > 1]
    return sorted(res, key=lambda g: g[0])


def plan_vs_fact(layer: MetricLayer, plan: pd.DataFrame, metric: str, by=("month",), tolerance: float = 0.05) -> pd.DataFrame:
    by = list(by)
    if not by:
        raise ValueError("bad by")
    for c in (*by, "plan"):
        if c not in plan.columns:
            raise ValueError(f"missing column: {c}")
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or tolerance < 0 or math.isnan(tolerance):
        raise ValueError("bad tolerance")
    p = plan[[*by, "plan"]].copy()
    for c in by:
        p[c] = p[c].where(p[c].notna(), NONE).astype(str)
    p["plan"] = pd.to_numeric(p["plan"], errors="coerce").astype("float64")
    if p.duplicated(by).any():
        raise ValueError("duplicate plan key")
    f = layer.query(metric, by).rename(columns={metric: "fact"})
    j = f.merge(p, on=by, how="outer", indicator=True)
    j.loc[j["_merge"] == "right_only", "fact"] = 0.0
    fact, pl = j["fact"].astype("float64"), j["plan"]
    delta = fact - pl
    pct = delta / pl.where(pl != 0)
    status = []
    for fv, pv, pc in zip(fact, pl, pct):
        if math.isnan(pv):
            status.append("no_plan")
        elif math.isnan(fv):
            status.append("no_fact")
        elif pv == 0:
            status.append("on_plan" if fv == 0 else "no_target")
        elif pc > tolerance:
            status.append("over")
        elif pc < -tolerance:
            status.append("under")
        else:
            status.append("on_plan")
    out = j[by].copy()
    out["fact"], out["plan"], out["delta"] = fact.round(2), pl.round(2), delta.round(2)
    out["delta_pct"] = pct.round(4)
    out["status"] = status
    return out.sort_values(by, kind="mergesort").reset_index(drop=True)
