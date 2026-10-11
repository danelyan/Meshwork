# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import math

import pandas as pd
import pytest

import abtest


def frame(nc, kc, nt, kt, rev=10.0):
    rows = []
    for g, n, k in (("control", nc, kc), ("treatment", nt, kt)):
        for i in range(n):
            c = 1 if i < k else 0
            rows.append({"user_id": f"{g[0]}{i}", "group": g, "converted": c, "revenue": rev * c})
    return pd.DataFrame(rows)


def test_sample_size_formula():
    assert abtest.sample_size(0.1, 0.02) == 3838


def test_srm_chi_square():
    r = abtest.check_srm(5200, 5000)
    assert r["chi2"] == pytest.approx(2 * 100**2 / 5100)
    assert r["p_value"] == pytest.approx(0.0477, abs=5e-4)
    assert r["srm"] is False
    assert abtest.check_srm(5400, 4800)["srm"] is True


def test_conversion_win():
    res = abtest.analyze(frame(1000, 100, 1000, 160))
    c = res["conversion"]
    assert c["diff"] == pytest.approx(0.06)
    assert c["significant"] is True and c["ci_low"] > 0
    assert res["decision"] == "win"


def test_no_effect_is_inconclusive():
    assert abtest.analyze(frame(1000, 100, 1000, 104))["decision"] == "inconclusive"
