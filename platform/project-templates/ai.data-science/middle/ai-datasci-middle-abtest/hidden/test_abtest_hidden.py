# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import math
from statistics import NormalDist

import numpy as np
import pandas as pd
import pytest

import abtest

Z = NormalDist().inv_cdf


def p2(z):
    return math.erfc(abs(z) / math.sqrt(2))


def frame(nc, kc, nt, kt, rev=10.0):
    rows = []
    for g, n, k in (("control", nc, kc), ("treatment", nt, kt)):
        for i in range(n):
            c = 1 if i < k else 0
            rows.append({"user_id": f"{g[0]}{i}", "group": g, "converted": c, "revenue": rev * c})
    return pd.DataFrame(rows)


def custom(ctl, trt):
    """ctl/trt: списки (converted, revenue)."""
    rows = []
    for g, items in (("control", ctl), ("treatment", trt)):
        for i, (c, r) in enumerate(items):
            rows.append({"user_id": f"{g[0]}{i}", "group": g, "converted": c, "revenue": r})
    return pd.DataFrame(rows)


class TestSampleSize:
    def test_values(self):
        assert abtest.sample_size(0.1, 0.02) == 3839
        z = Z(0.975) + Z(0.8)
        exp = math.ceil(z * z * (0.2 * 0.8 + 0.25 * 0.75) / 0.05**2)
        assert abtest.sample_size(0.2, 0.05) == exp

    def test_params_and_negative_mde(self):
        z = Z(1 - 0.01 / 2) + Z(0.9)
        exp = math.ceil(z * z * (0.3 * 0.7 + 0.2 * 0.8) / 0.1**2)
        assert abtest.sample_size(0.3, -0.1, alpha=0.01, power=0.9) == exp

    @pytest.mark.parametrize("args", [(0.0, 0.1), (1.0, 0.1), (0.5, 0.0), (0.95, 0.06), (0.05, -0.05)])
    def test_invalid(self, args):
        with pytest.raises(ValueError):
            abtest.sample_size(*args)


class TestSrm:
    def test_chi2_and_p(self):
        r = abtest.check_srm(5400, 4800)
        assert r["chi2"] == pytest.approx(2 * 300**2 / 5100)
        assert r["p_value"] == pytest.approx(math.erfc(math.sqrt(r["chi2"] / 2)))
        assert r["srm"] is True

    def test_expected_share(self):
        r = abtest.check_srm(800, 200, expected_control_share=0.8)
        assert r["chi2"] == pytest.approx(0.0)
        assert r["p_value"] == pytest.approx(1.0)
        assert r["srm"] is False
        r2 = abtest.check_srm(500, 500, expected_control_share=0.8)
        assert r2["chi2"] == pytest.approx(300**2 / 800 + 300**2 / 200)
        assert r2["srm"] is True

    def test_alpha_threshold(self):
        r = abtest.check_srm(5200, 5000)
        assert r["srm"] is False
        assert abtest.check_srm(5200, 5000, alpha=0.05)["srm"] is True

    @pytest.mark.parametrize("args", [(0, 0), (10, 10, 0.0), (10, 10, 1.0), (10, 10, 1.5)])
    def test_invalid(self, args):
        with pytest.raises(ValueError):
            abtest.check_srm(*args)


class TestAnalyzeStats:
    def test_conversion_numbers(self):
        res = abtest.analyze(frame(1000, 100, 1200, 168))
        c = res["conversion"]
        pc, pt = 0.1, 0.14
        se = math.sqrt(pc * 0.9 / 1000 + pt * 0.86 / 1200)
        pooled = 268 / 2200
        sep = math.sqrt(pooled * (1 - pooled) * (1 / 1000 + 1 / 1200))
        assert res["n"] == {"control": 1000, "treatment": 1200}
        assert c["control_rate"] == pytest.approx(pc)
        assert c["treatment_rate"] == pytest.approx(pt)
        assert c["diff"] == pytest.approx(0.04)
        assert c["se"] == pytest.approx(se)
        assert c["ci_low"] == pytest.approx(0.04 - Z(0.975) * se)
        assert c["ci_high"] == pytest.approx(0.04 + Z(0.975) * se)
        assert c["z"] == pytest.approx(0.04 / sep)
        assert c["p_value"] == pytest.approx(p2(0.04 / sep))
        assert c["significant"] is True

    def test_alpha_changes_ci_and_significance(self):
        df = frame(1000, 100, 1000, 128)
        a = abtest.analyze(df)["conversion"]
        b = abtest.analyze(df, alpha=0.01)["conversion"]
        assert a["significant"] is True and b["significant"] is False
        assert (b["ci_high"] - b["ci_low"]) > (a["ci_high"] - a["ci_low"])
        assert b["ci_high"] - b["ci_low"] == pytest.approx(2 * Z(0.995) * b["se"])

    def test_loss_and_decisions(self):
        assert abtest.analyze(frame(1000, 160, 1000, 100))["decision"] == "loss"
        assert abtest.analyze(frame(1000, 100, 1000, 160))["decision"] == "win"
        assert abtest.analyze(frame(1000, 100, 1000, 105))["decision"] == "inconclusive"

    def test_zero_variance_no_conversions(self):
        res = abtest.analyze(frame(50, 0, 50, 0))
        c = res["conversion"]
        assert c["z"] == 0.0 and c["p_value"] == 1.0 and c["significant"] is False
        assert c["se"] == 0.0 and c["ci_low"] == 0.0 and c["ci_high"] == 0.0
        assert res["decision"] == "inconclusive"
        assert res["revenue"]["z"] == 0.0 and res["revenue"]["p_value"] == 1.0

    def test_srm_overrides_significant_win(self):
        res = abtest.analyze(frame(1000, 100, 1300, 260))
        assert res["conversion"]["significant"] is True
        assert res["srm"]["srm"] is True
        assert res["srm"]["chi2"] == pytest.approx(2 * 150**2 / 1150)
        assert res["decision"] == "invalid"

    def test_srm_alpha_param(self):
        df = frame(1000, 100, 1150, 200)
        assert abtest.analyze(df)["decision"] == "win"
        res = abtest.analyze(df, srm_alpha=0.05)
        assert res["srm"]["srm"] is True and res["decision"] == "invalid"


class TestRevenue:
    def test_winsorization_and_welch(self):
        ctl = [(1, 10.0)] * 5 + [(0, 0.0)] * 4 + [(1, 1000.0)]
        trt = [(1, 12.0)] * 6 + [(0, 0.0)] * 4
        df = custom(ctl, trt)
        res = abtest.analyze(df, winsor_q=0.9)
        allrev = np.array([r for _, r in ctl + trt])
        cap = float(np.quantile(allrev, 0.9))
        rc = np.minimum([r for _, r in ctl], cap)
        rt = np.minimum([r for _, r in trt], cap)
        vc, vt = rc.var(ddof=1), rt.var(ddof=1)
        se = math.sqrt(vc / 10 + vt / 10)
        d = rt.mean() - rc.mean()
        r = res["revenue"]
        assert r["cap"] == pytest.approx(cap)
        assert r["cap"] < 1000.0
        assert r["mean_control"] == pytest.approx(rc.mean())
        assert r["mean_treatment"] == pytest.approx(rt.mean())
        assert r["diff"] == pytest.approx(d)
        assert r["se"] == pytest.approx(se)
        assert r["ci_low"] == pytest.approx(d - Z(0.975) * se)
        assert r["ci_high"] == pytest.approx(d + Z(0.975) * se)
        assert r["z"] == pytest.approx(d / se)
        assert r["p_value"] == pytest.approx(p2(d / se))
        assert r["significant"] is (p2(d / se) < 0.05)

    def test_default_quantile_cap(self):
        ctl = [(1, float(i)) for i in range(1, 51)]
        trt = [(1, float(i)) for i in range(51, 101)]
        r = abtest.analyze(custom(ctl, trt))["revenue"]
        assert r["cap"] == pytest.approx(float(np.quantile(np.arange(1, 101, dtype=float), 0.99)))
        assert r["cap"] == pytest.approx(99.01)

    def test_single_user_group_variance_zero(self):
        res = abtest.analyze(custom([(1, 5.0)], [(1, 7.0), (0, 0.0), (1, 9.0)]), winsor_q=1.0)
        r = res["revenue"]
        vt = np.var([7.0, 0.0, 9.0], ddof=1)
        assert r["se"] == pytest.approx(math.sqrt(vt / 3))
        assert r["diff"] == pytest.approx(16 / 3 - 5.0)


class TestValidation:
    def good(self):
        return frame(5, 2, 5, 3)

    def test_missing_column(self):
        for col in ["user_id", "group", "converted", "revenue"]:
            with pytest.raises(ValueError, match=f"missing column: {col}"):
                abtest.analyze(self.good().drop(columns=[col]))

    def test_bad_values_messages(self):
        d = self.good(); d.loc[0, "group"] = "other"
        with pytest.raises(ValueError, match="bad group"):
            abtest.analyze(d)
        d = self.good(); d["converted"] = d["converted"].astype(object); d.loc[0, "converted"] = 2
        with pytest.raises(ValueError, match="bad converted"):
            abtest.analyze(d)
        d = self.good(); d.loc[0, "revenue"] = -1.0
        with pytest.raises(ValueError, match="bad revenue"):
            abtest.analyze(d)
        d = self.good(); d.loc[0, "revenue"] = float("nan")
        with pytest.raises(ValueError, match="bad revenue"):
            abtest.analyze(d)
        d = self.good(); d.loc[1, "user_id"] = d.loc[0, "user_id"]
        with pytest.raises(ValueError, match="duplicate user_id"):
            abtest.analyze(d)

    def test_empty_group(self):
        d = self.good()
        with pytest.raises(ValueError, match="empty group"):
            abtest.analyze(d[d["group"] == "control"])

    def test_error_order(self):
        d = self.good(); d.loc[0, "group"] = "x"; d.loc[1, "revenue"] = -5.0
        with pytest.raises(ValueError, match="bad group"):
            abtest.analyze(d)

    def test_bool_converted_and_no_mutation(self):
        d = self.good()
        d["converted"] = d["converted"].astype(bool)
        before = d.copy(deep=True)
        res = abtest.analyze(d)
        pd.testing.assert_frame_equal(d, before)
        assert res["conversion"]["control_rate"] == pytest.approx(0.4)
        assert res["conversion"]["treatment_rate"] == pytest.approx(0.6)

    def test_row_order_independent(self):
        d = frame(300, 30, 300, 60)
        a = abtest.analyze(d)
        b = abtest.analyze(d.sample(frac=1.0, random_state=3).reset_index(drop=True))
        assert a["conversion"]["z"] == pytest.approx(b["conversion"]["z"])
        assert a["revenue"]["cap"] == pytest.approx(b["revenue"]["cap"])
        assert a["decision"] == b["decision"]
