"""Витрина метрик продаж по контракту (contract.md)."""
import pandas as pd

MART_COLS = ["order_id", "order_date", "month", "customer_id", "product_id", "category", "qty", "revenue"]
MONTHLY_COLS = ["month", "orders", "customers", "units", "revenue", "aov"]
SHARE_COLS = ["category", "revenue", "share"]


def _need(df: pd.DataFrame, cols: list[str]) -> None:
    for c in cols:
        if c not in df.columns:
            raise ValueError(f"missing column: {c}")


def _empty(cols: list[str]) -> pd.DataFrame:
    return pd.DataFrame({c: pd.Series(dtype="object") for c in cols})


def build_mart(orders: pd.DataFrame, items: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame:
    _need(orders, ["order_id", "customer_id", "order_date", "status"])
    _need(items, ["order_id", "product_id", "qty", "unit_price"])
    _need(products, ["product_id", "category"])

    o = orders[["order_id", "customer_id", "order_date", "status"]].copy()
    it = items[["order_id", "product_id", "qty", "unit_price"]].copy()
    pr = products[["product_id", "category"]].copy()
    for df, key in ((o, "order_id"), (it, "order_id"), (it, "product_id"), (pr, "product_id")):
        df[key] = df[key].astype(str).str.strip()
    o["customer_id"] = o["customer_id"].astype(str).str.strip()

    if pr["product_id"].duplicated().any():
        raise ValueError("duplicate product_id")
    if o["order_id"].duplicated().any():
        raise ValueError("duplicate order_id")

    it["qty"] = pd.to_numeric(it["qty"], errors="coerce")
    it["unit_price"] = pd.to_numeric(it["unit_price"], errors="coerce")
    if it["qty"].isna().any() or it["unit_price"].isna().any() or (it["qty"] <= 0).any() or (it["unit_price"] < 0).any():
        raise ValueError("bad item")

    o = o[o["status"] == "paid"].copy()
    o["order_date"] = pd.to_datetime(o["order_date"], format="%Y-%m-%d", errors="coerce")
    if o["order_date"].isna().any():
        raise ValueError("bad date")

    pr["category"] = pr["category"].where(pr["category"].notna(), "").astype(str).str.strip()
    pr.loc[pr["category"] == "", "category"] = "unknown"

    m = it.merge(o[["order_id", "customer_id", "order_date"]], on="order_id", how="inner")
    m = m.merge(pr, on="product_id", how="left")
    m["category"] = m["category"].fillna("unknown")
    m["qty"] = m["qty"].astype("float64")
    m["revenue"] = (m["qty"] * m["unit_price"]).astype("float64")
    m["month"] = m["order_date"].dt.strftime("%Y-%m")
    m = m[MART_COLS].sort_values(["order_id", "product_id"], kind="mergesort").reset_index(drop=True)
    if m.empty:
        e = _empty(MART_COLS)
        e["order_date"] = e["order_date"].astype("datetime64[ns]")
        e["qty"] = e["qty"].astype("float64")
        e["revenue"] = e["revenue"].astype("float64")
        return e
    return m


def monthly_metrics(mart: pd.DataFrame) -> pd.DataFrame:
    if mart.empty:
        return _empty(MONTHLY_COLS)
    g = mart.groupby("month", sort=True).agg(
        orders=("order_id", "nunique"), customers=("customer_id", "nunique"),
        units=("qty", "sum"), revenue=("revenue", "sum"),
    ).reset_index()
    g["aov"] = (g["revenue"] / g["orders"]).round(2)
    g["revenue"] = g["revenue"].round(2)
    g["units"] = g["units"].astype("float64")
    return g[MONTHLY_COLS].reset_index(drop=True)


def category_share(mart: pd.DataFrame) -> pd.DataFrame:
    if mart.empty:
        return _empty(SHARE_COLS)
    g = mart.groupby("category", sort=False)["revenue"].sum().reset_index()
    total = g["revenue"].sum()
    g["share"] = (g["revenue"] / total).round(4) if total > 0 else 0.0
    g["revenue"] = g["revenue"].round(2)
    g["share"] = g["share"].astype("float64")
    g = g.sort_values(["revenue", "category"], ascending=[False, True], kind="mergesort").reset_index(drop=True)
    return g[SHARE_COLS]
