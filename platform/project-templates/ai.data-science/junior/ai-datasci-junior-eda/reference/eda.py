"""Очистка таблицы пользователей и сводка по контракту (contract.md)."""
import numpy as np
import pandas as pd

REQUIRED = ["user_id", "age", "city", "amount", "signup_date"]
SUMMARY_COLS = ["city", "users", "mean_age", "total_amount", "median_amount", "outliers"]


def _strip(s: pd.Series) -> pd.Series:
    return s.map(lambda v: v.strip() if isinstance(v, str) else v)


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    for col in REQUIRED:
        if col not in df.columns:
            raise ValueError(f"missing column: {col}")
    work = df[REQUIRED].copy()
    rows_in = len(work)

    uid = _strip(work["user_id"])
    ok = uid.notna() & (uid.astype(str) != "")
    work = work[ok].copy()
    work["user_id"] = uid[ok].astype(str)
    dropped = rows_in - len(work)

    age = pd.to_numeric(_strip(work["age"]), errors="coerce").astype("float64")
    work["age"] = age.where((age >= 0) & (age <= 120))
    amount = _strip(work["amount"]).map(lambda v: v.replace(",", ".") if isinstance(v, str) else v)
    work["amount"] = pd.to_numeric(amount, errors="coerce").astype("float64")
    work["signup_date"] = pd.to_datetime(_strip(work["signup_date"]), format="%Y-%m-%d", errors="coerce").astype("datetime64[ns]")
    city = _strip(work["city"]).map(lambda v: str(v).lower() if pd.notna(v) else np.nan)
    work["city"] = city.replace("", np.nan)

    before = len(work)
    work = work.sort_values("signup_date", kind="stable", na_position="first")
    work = work.drop_duplicates("user_id", keep="last")
    duplicates = before - len(work)

    missing = {c: int(work[c].isna().sum()) for c in ["age", "city", "amount", "signup_date"]}
    age_median = work["age"].median()
    age_median = None if pd.isna(age_median) else float(age_median)
    if age_median is not None:
        work["age"] = work["age"].fillna(age_median)
    work["city"] = work["city"].fillna("unknown").astype(str)

    known = work["amount"].dropna()
    if len(known) == 0:
        bounds = None
        work["amount_outlier"] = False
    else:
        q1, q3 = known.quantile(0.25), known.quantile(0.75)
        iqr = q3 - q1
        lo, hi = float(q1 - 1.5 * iqr), float(q3 + 1.5 * iqr)
        bounds = [lo, hi]
        work["amount_outlier"] = ((work["amount"] < lo) | (work["amount"] > hi)).fillna(False).astype(bool)

    work = work.sort_values("user_id", kind="stable").reset_index(drop=True)
    work = work[["user_id", "age", "city", "amount", "signup_date", "amount_outlier"]]
    report = {
        "rows_in": rows_in,
        "dropped_no_id": dropped,
        "duplicates_removed": duplicates,
        "rows_out": len(work),
        "missing": missing,
        "age_median": age_median,
        "amount_bounds": bounds,
        "outliers": int(work["amount_outlier"].sum()),
    }
    return work, report


def summarize(clean_df: pd.DataFrame) -> pd.DataFrame:
    if len(clean_df) == 0:
        return pd.DataFrame(columns=SUMMARY_COLS)
    g = clean_df.groupby("city")
    out = pd.DataFrame({
        "users": g.size(),
        "mean_age": g["age"].mean(),
        "total_amount": g["amount"].sum(min_count=0),
        "median_amount": g["amount"].median(),
        "outliers": g["amount_outlier"].sum().astype("int64"),
    }).reset_index()
    out["users"] = out["users"].astype("int64")
    out["total_amount"] = out["total_amount"].astype("float64")
    out = out.sort_values(["total_amount", "city"], ascending=[False, True], kind="stable")
    for c in ["mean_age", "total_amount", "median_amount"]:
        out[c] = out[c].round(2)
    return out.reset_index(drop=True)[SUMMARY_COLS]
