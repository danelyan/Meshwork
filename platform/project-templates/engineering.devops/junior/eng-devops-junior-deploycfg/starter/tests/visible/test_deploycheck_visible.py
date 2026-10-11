# PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import copy
import unittest

import deploycheck

GOOD = {
    "name": "billing-api",
    "image": "registry.local/billing/api:1.4.2",
    "replicas": 3,
    "port": 8080,
    "env": {"LOG_LEVEL": "info", "DB_PASSWORD": {"secretRef": "billing-db/password"}},
    "resources": {
        "cpu": {"request": "250m", "limit": "500m"},
        "memory": {"request": "128Mi", "limit": "256Mi"},
    },
}


def codes(cfg):
    return [(e["path"], e["code"]) for e in deploycheck.validate(cfg)]


class DeployCheckVisible(unittest.TestCase):
    def test_valid_config(self):
        self.assertEqual(deploycheck.validate(GOOD), [])

    def test_missing_field(self):
        cfg = copy.deepcopy(GOOD)
        del cfg["port"]
        self.assertEqual(codes(cfg), [("port", "missing")])

    def test_plaintext_secret(self):
        cfg = copy.deepcopy(GOOD)
        cfg["env"]["DB_PASSWORD"] = "hunter2"
        self.assertEqual(codes(cfg), [("env.DB_PASSWORD", "plaintext_secret")])

    def test_request_exceeds_limit(self):
        cfg = copy.deepcopy(GOOD)
        cfg["resources"]["memory"] = {"request": "512Mi", "limit": "256Mi"}
        self.assertEqual(codes(cfg), [("resources.memory", "request_exceeds_limit")])
