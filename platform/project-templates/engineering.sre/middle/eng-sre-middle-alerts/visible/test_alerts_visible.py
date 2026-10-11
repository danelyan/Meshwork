# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import unittest

from alerts import AlertEngine


class Clock:
    def __init__(self, t=1000):
        self.t = t

    def __call__(self):
        return self.t


RULE = {"name": "Burn", "slo": 0.99, "windows": [{"long_s": 600, "short_s": 60, "burn": 10}], "labels": {"team": "pay"}}


def make(rule=None):
    clock, sent = Clock(), []
    return AlertEngine([dict(rule or RULE)], clock, sent.append), clock, sent


def burst(eng, service, ok, bad):
    for _ in range(ok):
        eng.record(service, True)
    for _ in range(bad):
        eng.record(service, False)


class AlertsVisible(unittest.TestCase):
    def test_fires_once_with_labels(self):
        eng, clock, sent = make()
        burst(eng, "api", 80, 20)
        eng.evaluate()
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "firing")
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["type"], "firing")
        self.assertEqual(sent[0]["labels"], {"team": "pay", "alertname": "Burn", "service": "api"})

    def test_short_window_must_also_burn(self):
        eng, clock, sent = make()
        burst(eng, "api", 0, 20)
        clock.t += 300
        burst(eng, "api", 20, 0)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "inactive")
        self.assertEqual(sent, [])

    def test_pending_then_firing_then_resolved(self):
        eng, clock, sent = make({**RULE, "for_s": 120})
        burst(eng, "api", 0, 10)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "pending")
        clock.t += 120
        burst(eng, "api", 0, 10)  # ошибки продолжаются: короткое окно (60 с) должно по-прежнему гореть
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "firing")
        clock.t += 700
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "resolved")
        self.assertEqual([n["type"] for n in sent], ["firing", "resolved"])

    def test_silence_mutes_notification_not_state(self):
        eng, clock, sent = make()
        eng.add_silence({"service": "api"}, 300)
        burst(eng, "api", 0, 10)
        eng.evaluate()
        self.assertEqual(eng.state("Burn", "api"), "firing")
        self.assertEqual(sent, [])
        self.assertTrue(eng.alerts()[0]["silenced"])

    def test_invalid_rule(self):
        with self.assertRaises(ValueError):
            AlertEngine([{**RULE, "slo": 1}], Clock(), print)


if __name__ == "__main__":
    unittest.main()
