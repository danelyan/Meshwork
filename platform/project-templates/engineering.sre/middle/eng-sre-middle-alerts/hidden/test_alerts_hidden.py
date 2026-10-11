# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import unittest

from alerts import AlertEngine


class Clock:
    def __init__(self, t=1000):
        self.t = t

    def __call__(self):
        return self.t


def win(long_s=600, short_s=60, burn=10):
    return {"long_s": long_s, "short_s": short_s, "burn": burn}


def rule(**kw):
    base = {"name": "Burn", "slo": 0.99, "windows": [win()]}
    base.update(kw)
    return base


def make(rules=None, notify=None):
    clock, sent = Clock(), []
    eng = AlertEngine(rules if rules is not None else [rule()], clock, notify or sent.append)
    return eng, clock, sent


def burst(eng, service, ok, bad):
    for _ in range(ok):
        eng.record(service, True)
    for _ in range(bad):
        eng.record(service, False)


def types(sent):
    return [n["type"] for n in sent]


class Validation(unittest.TestCase):
    def test_bad_rules_raise(self):
        bad = [
            rule(name=""),
            rule(slo=0),
            rule(slo=1),
            rule(windows=[]),
            rule(windows=[win(long_s=60, short_s=60)]),
            rule(windows=[win(short_s=0)]),
            rule(windows=[win(burn=0)]),
            rule(for_s=-1),
            rule(keep_firing_for_s=-1),
            rule(repeat_interval_s=0),
        ]
        for r in bad:
            with self.assertRaises(ValueError, msg=str(r)):
                AlertEngine([r], Clock(), print)
        with self.assertRaises(ValueError):
            AlertEngine([{"name": "x", "slo": 0.9}], Clock(), print)
        with self.assertRaises(ValueError):
            AlertEngine([rule(), rule()], Clock(), print)

    def test_rules_are_copied(self):
        r = rule()
        eng, clock, sent = make([r])
        r["windows"][0]["burn"] = 10_000
        burst(eng, "api", 0, 5)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "firing")


class Condition(unittest.TestCase):
    def test_burn_threshold_is_inclusive(self):
        eng, clock, sent = make([rule(slo=0.9, windows=[win(burn=5)])])
        burst(eng, "a", 5, 5)  # ratio 0.5 / 0.1 = 5.0
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        eng2, _, _ = make([rule(slo=0.9, windows=[win(burn=5)])])
        burst(eng2, "a", 6, 4)  # 4.0
        eng2.evaluate()
        self.assertEqual(eng2.state("Burn", "a"), "inactive")

    def test_old_errors_leave_short_window(self):
        eng, clock, sent = make([rule(slo=0.9, windows=[win(600, 60, 5)])])
        burst(eng, "a", 0, 10)
        clock.t += 300
        burst(eng, "a", 10, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "inactive")  # long: 0.5, short: 0
        burst(eng, "a", 0, 10)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")

    def test_any_window_pair_is_enough(self):
        wins = [win(3600, 300, 14), win(600, 60, 5)]
        eng, clock, sent = make([rule(slo=0.9, windows=wins)])
        burst(eng, "a", 5, 5)  # 5.0: second pair only
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")

    def test_window_lower_bound_is_exclusive(self):
        eng, clock, sent = make([rule(slo=0.9, windows=[win(600, 60, 5)])])
        burst(eng, "a", 0, 10)
        clock.t += 60  # события ровно на t - short_s не входят в короткое окно
        burst(eng, "a", 10, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "inactive")

    def test_empty_windows_do_not_alert(self):
        eng, clock, sent = make()
        eng.record("a", False)
        clock.t += 100_000
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "inactive")
        self.assertEqual(eng.state("Nope", "zzz"), "inactive")
        self.assertEqual(eng.alerts(), [])

    def test_services_are_independent(self):
        eng, clock, sent = make()
        burst(eng, "a", 0, 10)
        burst(eng, "b", 100, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        self.assertEqual(eng.state("Burn", "b"), "inactive")
        self.assertEqual([x["service"] for x in eng.alerts()], ["a"])


class Lifecycle(unittest.TestCase):
    def test_pending_cancelled_is_silent(self):
        eng, clock, sent = make([rule(for_s=120, slo=0.9, windows=[win(600, 60, 5)])])
        burst(eng, "a", 0, 10)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "pending")
        self.assertEqual(eng.alerts()[0]["since"], 1000)
        clock.t += 61  # короткое окно очистилось от ошибок
        burst(eng, "a", 10, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "inactive")
        clock.t += 500
        eng.evaluate()
        self.assertEqual(sent, [])

    def test_firing_waits_for_duration(self):
        eng, clock, sent = make([rule(for_s=120)])
        burst(eng, "a", 0, 10)
        eng.evaluate()
        clock.t += 119
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "pending")
        clock.t += 1
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        self.assertEqual(eng.alerts()[0]["since"], 1120)
        self.assertEqual(types(sent), ["firing"])

    def test_dedup_and_repeat_interval(self):
        eng, clock, sent = make([rule(repeat_interval_s=1000, windows=[win(100_000, 60, 10)])])
        burst(eng, "a", 0, 10)
        for _ in range(3):
            eng.evaluate()
        self.assertEqual(len(sent), 1)
        clock.t += 999
        burst(eng, "a", 0, 3)
        eng.evaluate()
        self.assertEqual(len(sent), 1)
        clock.t += 1
        burst(eng, "a", 0, 3)
        eng.evaluate()
        self.assertEqual(types(sent), ["firing", "firing"])
        self.assertEqual(sent[1]["at"], 2000)

    def test_resolved_once_then_new_incident_notifies_immediately(self):
        eng, clock, sent = make([rule(repeat_interval_s=10_000)])
        burst(eng, "a", 0, 10)
        eng.evaluate()
        clock.t += 700
        eng.evaluate()
        eng.evaluate()
        self.assertEqual(types(sent), ["firing", "resolved"])
        self.assertEqual(eng.state("Burn", "a"), "resolved")
        burst(eng, "a", 0, 10)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        self.assertEqual(types(sent), ["firing", "resolved", "firing"])

    def test_keep_firing_for_holds_flapping(self):
        eng, clock, sent = make([rule(keep_firing_for_s=300, slo=0.9, windows=[win(600, 60, 5)])])
        burst(eng, "a", 0, 10)
        eng.evaluate()
        clock.t += 100  # условие ложно с этого момента
        burst(eng, "a", 10, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        clock.t += 150
        burst(eng, "a", 0, 10)  # снова истинно: счётчик «ложно» сбрасывается
        eng.evaluate()
        clock.t += 100
        burst(eng, "a", 10, 0)
        eng.evaluate()
        clock.t += 299
        burst(eng, "a", 10, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        clock.t += 1
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "resolved")
        self.assertEqual(types(sent), ["firing", "resolved"])


class Silences(unittest.TestCase):
    def test_silence_matches_all_pairs_and_expires(self):
        eng, clock, sent = make([rule(labels={"team": "pay"})])
        sid = eng.add_silence({"team": "pay", "service": "a"}, 300)
        self.assertTrue(isinstance(sid, str) and sid)
        burst(eng, "a", 0, 10)
        burst(eng, "b", 0, 10)
        eng.evaluate()
        self.assertEqual([n["labels"]["service"] for n in sent], ["b"])
        self.assertEqual({x["service"]: x["silenced"] for x in eng.alerts()}, {"a": True, "b": False})
        clock.t += 299
        burst(eng, "a", 0, 5)
        eng.evaluate()
        self.assertEqual(len(sent), 1)
        clock.t += 1
        burst(eng, "a", 0, 5)
        eng.evaluate()
        self.assertEqual([n["labels"]["service"] for n in sent], ["b", "a"])
        self.assertFalse(eng.alerts()[0]["silenced"])

    def test_partial_or_missing_label_does_not_match(self):
        eng, clock, sent = make([rule(labels={"team": "pay"})])
        eng.add_silence({"team": "pay", "env": "prod"}, 300)  # у алерта нет метки env
        eng.add_silence({"service": "other"}, 300)
        burst(eng, "a", 0, 10)
        eng.evaluate()
        self.assertEqual(types(sent), ["firing"])

    def test_remove_silence(self):
        eng, clock, sent = make()
        sid = eng.add_silence({"alertname": "Burn"}, 1000)
        burst(eng, "a", 0, 10)
        eng.evaluate()
        self.assertEqual(sent, [])
        self.assertTrue(eng.remove_silence(sid))
        self.assertFalse(eng.remove_silence(sid))
        self.assertFalse(eng.remove_silence("unknown"))
        eng.evaluate()
        self.assertEqual(types(sent), ["firing"])

    def test_invalid_silence(self):
        eng, _, _ = make()
        for args in (({}, 10), ({"a": "b"}, 0), ({"a": "b"}, -5)):
            with self.assertRaises(ValueError):
                eng.add_silence(*args)

    def test_resolved_under_silence_is_dropped_and_firing_never_delivered_means_no_resolved(self):
        eng, clock, sent = make()
        eng.add_silence({"alertname": "Burn"}, 100_000)
        burst(eng, "a", 0, 10)
        eng.evaluate()
        clock.t += 700
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "resolved")
        self.assertEqual(sent, [])
        eng2, clock2, sent2 = make()
        burst(eng2, "a", 0, 10)
        eng2.evaluate()
        eng2.add_silence({"alertname": "Burn"}, 50)
        clock2.t += 700
        eng2.evaluate()
        self.assertEqual(types(sent2), ["firing"])  # resolved под молчанием не отправлен и не досылается
        clock2.t += 100
        eng2.evaluate()
        self.assertEqual(types(sent2), ["firing"])


class Delivery(unittest.TestCase):
    def test_failed_firing_is_retried_next_evaluate(self):
        sent, fail = [], [True]

        def notify(e):
            if fail[0]:
                raise RuntimeError("down")
            sent.append(e)

        eng, clock, _ = make(notify=notify)
        burst(eng, "a", 0, 10)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "a"), "firing")
        self.assertEqual(sent, [])
        fail[0] = False
        clock.t += 5
        eng.evaluate()
        eng.evaluate()
        self.assertEqual(types(sent), ["firing"])
        self.assertEqual(sent[0]["at"], 1005)

    def test_failed_resolved_is_retried_and_dropped_on_refire(self):
        sent, fail = [], [False]

        def notify(e):
            if fail[0] and e["type"] == "resolved":
                raise RuntimeError("down")
            sent.append(e)

        eng, clock, _ = make(notify=notify)
        burst(eng, "a", 0, 10)
        eng.evaluate()
        fail[0] = True
        clock.t += 700
        eng.evaluate()
        eng.evaluate()
        self.assertEqual(types(sent), ["firing"])
        fail[0] = False
        eng.evaluate()
        self.assertEqual(types(sent), ["firing", "resolved"])
        eng.evaluate()
        self.assertEqual(types(sent), ["firing", "resolved"])

    def test_notification_labels_are_a_copy(self):
        eng, clock, sent = make([rule(labels={"team": "pay"})])
        burst(eng, "a", 0, 10)
        eng.evaluate()
        sent[0]["labels"]["team"] = "hacked"
        self.assertEqual(eng.alerts()[0]["labels"]["team"], "pay")


if __name__ == "__main__":
    unittest.main()
