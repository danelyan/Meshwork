"""Анализ A/B-теста по контракту (contract.md)."""
import math
from statistics import NormalDist

import numpy as np
import pandas as pd

_N = NormalDist()


def _p_two_sided(z: float) -> float:
    return math.erfc(abs(z) / math.sqrt(2))


def sample_size(baseline: float, mde: float, alpha: float = 0.05, power: float = 0.8) -> int:
    p1, p2 = baseline, baseline + mde
    if not (0 < p1 < 1) or not (0 < p2 < 1) or mde == 0:
        raise ValueError("bad baseline or mde")
    z = _N.inv_cdf(1 - alpha / 2) + _N.inv_cdf(power)
    return math.ceil(z * z * (p1 * (1 - p1) + p2 * (1 - p2)) / (mde * mde))


def check_srm(n_control: int, n_treatment: int, expected_control_share: float = 0.5, alpha: float = 0.001) -> dict:
    total = n_control + n_treatment
    if total == 0 or not (0 < expected_control_share < 1):
        raise ValueError("bad srm input")
    e_c = total * expected_control_share
    e_t = total - e_c
    chi2 = (n_control - e_c) ** 2 / e_c + (n_treatment - e_t) ** 2 / e_t
    p = math.erfc(math.sqrt(chi2 / 2))
    return {"chi2": chi2, "p_value": p, "srm": p < alpha}


def _validate(df: pd.DataFrame) -> None:
    for col in ["user_id", "group", "converted", "revenue"]:
        if col not in df.columns:
            raise ValueError(f"missing column: {col}")
    if not df["group"].isin(["control", "treatment"]).all():
        raise ValueError("bad group")
    if not df["converted"].isin([0, 1, True, False]).all():
        raise ValueError("bad converted")
    rev = pd.to_numeric(df["revenue"], errors="coerce")
    if rev.isna().any() or (rev < 0).any():
        raise ValueError("bad revenue")
    if df["user_id"].duplicated().any():
        raise ValueError("duplicate user_id")
    if set(df["group"]) != {"control", "treatment"}:
        raise ValueError("empty group")


def analyze(df: pd.DataFrame, alpha: float = 0.05, srm_alpha: float = 0.001, winsor_q: float = 0.99) -> dict:
    _validate(df)
    zc = _N.inv_cdf(1 - alpha / 2)
    ctl = df["group"] == "control"
    conv = df["converted"].astype(int).to_numpy()
    rev = df["revenue"].astype(float).to_numpy()
    is_c = ctl.to_numpy()
    nc, nt = int(is_c.sum()), int((~is_c).sum())

    kc, kt = int(conv[is_c].sum()), int(conv[~is_c].sum())
    pc, pt = kc / nc, kt / nt
    diff = pt - pc
    se = math.sqrt(pc * (1 - pc) / nc + pt * (1 - pt) / nt)
    pooled = (kc + kt) / (nc + nt)
    se_p = math.sqrt(pooled * (1 - pooled) * (1 / nc + 1 / nt))
    z, p = (diff / se_p, _p_two_sided(diff / se_p)) if se_p > 0 else (0.0, 1.0)
    conversion = {"control_rate": pc, "treatment_rate": pt, "diff": diff, "se": se,
                  "ci_low": diff - zc * se, "ci_high": diff + zc * se, "z": z, "p_value": p, "significant": p < alpha}

    cap = float(np.quantile(rev, winsor_q))
    capped = np.minimum(rev, cap)
    rc, rt = capped[is_c], capped[~is_c]
    vc = float(np.var(rc, ddof=1)) if nc > 1 else 0.0
    vt = float(np.var(rt, ddof=1)) if nt > 1 else 0.0
    rdiff = float(rt.mean() - rc.mean())
    rse = math.sqrt(vc / nc + vt / nt)
    rz, rp = (rdiff / rse, _p_two_sided(rdiff / rse)) if rse > 0 else (0.0, 1.0)
    revenue = {"mean_control": float(rc.mean()), "mean_treatment": float(rt.mean()), "diff": rdiff, "se": rse,
               "ci_low": rdiff - zc * rse, "ci_high": rdiff + zc * rse, "z": rz, "p_value": rp,
               "significant": rp < alpha, "cap": cap}

    srm = check_srm(nc, nt, 0.5, srm_alpha)
    if srm["srm"]:
        decision = "invalid"
    elif conversion["significant"] and diff > 0:
        decision = "win"
    elif conversion["significant"] and diff < 0:
        decision = "loss"
    else:
        decision = "inconclusive"
    return {"n": {"control": nc, "treatment": nt}, "srm": srm, "conversion": conversion, "revenue": revenue,
            "decision": decision}
