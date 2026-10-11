"""Retention и воронка с проверками качества данных по контракту (contract.md)."""
import pandas as pd

ALLOWED = ("signup", "activate", "purchase", "visit")
ISSUES = ("no_user", "bad_ts", "unknown_event", "future", "duplicates")


def _as_of_end(as_of) -> pd.Timestamp:
    try:
        if not isinstance(as_of, str):
            raise TypeError
        d = pd.to_datetime(as_of, format="%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValueError("bad as_of")
    return d + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)


def check_events(events: pd.DataFrame, as_of: str) -> tuple[pd.DataFrame, dict]:
    for c in ("user_id", "event", "ts"):
        if c not in events.columns:
            raise ValueError(f"missing column: {c}")
    end = _as_of_end(as_of)
    df = events[["user_id", "event", "ts"]].copy().reset_index(drop=True)
    uid = df["user_id"].where(df["user_id"].notna(), "").astype(str).str.strip()
    ev = df["event"].where(df["event"].notna(), "").astype(str).str.strip().str.lower()
    ts = pd.to_datetime(df["ts"], format="ISO8601", errors="coerce")
    df = pd.DataFrame({"user_id": uid, "event": ev, "ts": ts})

    report = {"rows_in": len(df)}
    alive = pd.Series(True, index=df.index)
    masks = {
        "no_user": df["user_id"] == "",
        "bad_ts": df["ts"].isna(),
        "unknown_event": ~df["event"].isin(ALLOWED),
        "future": df["ts"] > end,
    }
    for name, mask in masks.items():
        hit = alive & mask
        report[name] = int(hit.sum())
        alive &= ~hit
    kept = df[alive]
    dup = kept.duplicated(["user_id", "event", "ts"], keep="first")
    report["duplicates"] = int(dup.sum())
    clean = kept[~dup].sort_values(["ts", "user_id", "event"], kind="mergesort").reset_index(drop=True)
    clean["ts"] = clean["ts"].astype("datetime64[ns]")
    report["rows_out"] = len(clean)

    first = clean.groupby("user_id")["ts"].min()
    signup = clean[clean["event"] == "signup"].groupby("user_id")["ts"].min()
    users = first.index
    report["users_without_signup"] = int((~users.isin(signup.index)).sum())
    report["signup_after_activity"] = int((signup > first.reindex(signup.index)).sum())
    return clean, {k: report[k] for k in ("rows_in", "rows_out", *ISSUES, "users_without_signup", "signup_after_activity")}


def weekly_retention(events: pd.DataFrame, as_of: str, weeks: int = 4) -> pd.DataFrame:
    if isinstance(weeks, bool) or not isinstance(weeks, int) or weeks < 0:
        raise ValueError("bad weeks")
    clean, _ = check_events(events, as_of)
    cols = ["cohort", "size"] + [f"week_{k}" for k in range(weeks + 1)]
    signup = clean[clean["event"] == "signup"].groupby("user_id")["ts"].min()
    if signup.empty:
        return pd.DataFrame({c: pd.Series(dtype="object") for c in cols})
    start = (signup.dt.normalize() - pd.to_timedelta(signup.dt.weekday, unit="D"))
    cohort_of = start.rename("cohort_start")
    act = clean[clean["user_id"].isin(cohort_of.index)].merge(cohort_of, left_on="user_id", right_index=True)
    act["k"] = (act["ts"].dt.normalize() - act["cohort_start"]).dt.days // 7
    act = act[(act["k"] >= 0) & (act["k"] <= weeks)].drop_duplicates(["user_id", "k"])
    as_of_day = pd.to_datetime(as_of, format="%Y-%m-%d")
    rows = []
    for cs, members in cohort_of.groupby(cohort_of):
        size = len(members)
        row = {"cohort": cs.strftime("%Y-%m-%d"), "size": size}
        sub = act[act["cohort_start"] == cs]
        for k in range(weeks + 1):
            if cs + pd.Timedelta(days=7 * k) > as_of_day:
                row[f"week_{k}"] = float("nan")
            else:
                row[f"week_{k}"] = round(int((sub["k"] == k).sum()) / size, 4)
        rows.append(row)
    out = pd.DataFrame(rows, columns=cols).sort_values("cohort").reset_index(drop=True)
    return out


def funnel(events: pd.DataFrame, as_of: str, steps=("signup", "activate", "purchase"), window_days: int = 7) -> pd.DataFrame:
    steps = tuple(steps)
    if not steps or len(set(steps)) != len(steps) or any(s not in ALLOWED for s in steps):
        raise ValueError("bad steps")
    if isinstance(window_days, bool) or not isinstance(window_days, int) or window_days < 0:
        raise ValueError("bad window")
    clean, _ = check_events(events, as_of)
    by_user = {u: g for u, g in clean.groupby("user_id")}
    reached = [0] * len(steps)
    for g in by_user.values():
        times = {s: list(g.loc[g["event"] == s, "ts"]) for s in steps}  # уже по возрастанию
        if not times[steps[0]]:
            continue
        t = times[steps[0]][0]
        limit = t + pd.Timedelta(days=window_days)
        reached[0] += 1
        for i in range(1, len(steps)):
            nxt = next((x for x in times[steps[i]] if x >= t and x <= limit), None)
            if nxt is None:
                break
            t = nxt
            reached[i] += 1
    rows = []
    for i, s in enumerate(steps):
        prev = reached[i - 1] if i else reached[0]
        start = reached[0]
        rows.append({
            "step": s, "users": reached[i],
            "from_prev": 1.0 if i == 0 else (round(reached[i] / prev, 4) if prev else 0.0),
            "from_start": 1.0 if i == 0 else (round(reached[i] / start, 4) if start else 0.0),
        })
    return pd.DataFrame(rows, columns=["step", "users", "from_prev", "from_start"])
