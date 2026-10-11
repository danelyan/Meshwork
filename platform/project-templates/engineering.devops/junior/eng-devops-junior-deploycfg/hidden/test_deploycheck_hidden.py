# PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import copy
import json
import os
import subprocess
import sys
import tempfile
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


def good():
    return copy.deepcopy(GOOD)


def codes(cfg):
    return [(e["path"], e["code"]) for e in deploycheck.validate(cfg)]


class Structure(unittest.TestCase):
    def test_valid_and_result_shape(self):
        self.assertEqual(deploycheck.validate(good()), [])
        cfg = good()
        cfg["port"] = 0
        errs = deploycheck.validate(cfg)
        self.assertEqual(len(errs), 1)
        self.assertEqual(set(errs[0]), {"path", "code", "message"})
        self.assertTrue(isinstance(errs[0]["message"], str) and errs[0]["message"])

    def test_not_object(self):
        for bad in ([], "x", 5, None):
            self.assertEqual(codes(bad), [("$", "not_object")])

    def test_missing_and_unknown_sorted(self):
        cfg = good()
        del cfg["name"]
        del cfg["resources"]
        cfg["zone"] = "eu"
        cfg["extra"] = 1
        self.assertEqual(
            codes(cfg),
            [("extra", "unknown_field"), ("name", "missing"), ("resources", "missing"), ("zone", "unknown_field")],
        )

    def test_env_optional(self):
        cfg = good()
        del cfg["env"]
        self.assertEqual(deploycheck.validate(cfg), [])

    def test_all_errors_collected(self):
        cfg = good()
        cfg["name"] = "Bad_Name"
        cfg["replicas"] = 0
        cfg["image"] = "app:latest"
        self.assertEqual(codes(cfg), [("image", "latest_tag"), ("name", "invalid_name"), ("replicas", "out_of_range")])


class Scalars(unittest.TestCase):
    def test_name(self):
        for ok in ("a", "web-1", "a" * 40):
            cfg = good()
            cfg["name"] = ok
            self.assertEqual(deploycheck.validate(cfg), [], ok)
        for bad in ("", "1web", "Web", "web_1", "a" * 41, "-web"):
            cfg = good()
            cfg["name"] = bad
            self.assertEqual(codes(cfg), [("name", "invalid_name")], bad)
        cfg = good()
        cfg["name"] = 5
        self.assertEqual(codes(cfg), [("name", "wrong_type")])

    def test_image(self):
        for ok in ("nginx:1.25", "localhost:5000/app:v2", "reg.io/a/b:2026-10-01"):
            cfg = good()
            cfg["image"] = ok
            self.assertEqual(deploycheck.validate(cfg), [], ok)
        for bad in ("nginx", "reg.io:5000/app", "app:", ":1.0", "reg.io/app:1/2"):
            cfg = good()
            cfg["image"] = bad
            self.assertEqual(codes(cfg), [("image", "invalid_image")], bad)
        cfg = good()
        cfg["image"] = "reg.io/app:latest"
        self.assertEqual(codes(cfg), [("image", "latest_tag")])
        cfg["image"] = ["x"]
        self.assertEqual(codes(cfg), [("image", "wrong_type")])

    def test_replicas_and_port_bounds_and_types(self):
        for key, lo, hi in (("replicas", 1, 20), ("port", 1, 65535)):
            for v in (lo, hi):
                cfg = good()
                cfg[key] = v
                self.assertEqual(deploycheck.validate(cfg), [], (key, v))
            for v in (lo - 1, hi + 1, -5):
                cfg = good()
                cfg[key] = v
                self.assertEqual(codes(cfg), [(key, "out_of_range")], (key, v))
            for v in (True, 1.5, "3", None):
                cfg = good()
                cfg[key] = v
                self.assertEqual(codes(cfg), [(key, "wrong_type")], (key, v))


class Env(unittest.TestCase):
    def test_env_wrong_type(self):
        cfg = good()
        cfg["env"] = ["A=1"]
        self.assertEqual(codes(cfg), [("env", "wrong_type")])

    def test_names_and_values(self):
        cfg = good()
        cfg["env"] = {"log_level": "x", "1BAD": "y", "OK_1": "z", "N": 5, "T": None}
        self.assertEqual(
            codes(cfg),
            [("env.1BAD", "invalid_env_name"), ("env.N", "wrong_type"), ("env.T", "wrong_type"), ("env.log_level", "invalid_env_name")],
        )

    def test_plaintext_secret_by_name(self):
        cfg = good()
        cfg["env"] = {
            "API_KEY": "abc",
            "GH_TOKEN": "",
            "CLIENT_SECRET": "s",
            "DB_PASSWORD": "p",
            "KEYBOARD_LAYOUT": "qwerty",
            "MONKEY_COUNT": "3",
            "LOG_LEVEL": "debug",
        }
        self.assertEqual(
            codes(cfg),
            [
                ("env.API_KEY", "plaintext_secret"),
                ("env.CLIENT_SECRET", "plaintext_secret"),
                ("env.DB_PASSWORD", "plaintext_secret"),
                ("env.GH_TOKEN", "plaintext_secret"),
                ("env.KEYBOARD_LAYOUT", "plaintext_secret"),
                ("env.MONKEY_COUNT", "plaintext_secret"),
            ],
        )

    def test_secret_ref(self):
        cfg = good()
        cfg["env"] = {
            "API_KEY": {"secretRef": "vault-1/api.key_2"},
            "LOG_LEVEL": {"secretRef": "cfg/level"},
            "A": {"secretRef": "nostore"},
            "B": {"secretRef": "Up/key"},
            "C": {"secretRef": 5},
            "D": {},
            "E": {"secretRef": "a/b", "value": "x"},
            "F": {"value": "x"},
            "G": {"secretRef": "a/b/c"},
        }
        self.assertEqual(
            codes(cfg),
            [(f"env.{k}", "invalid_secret_ref") for k in "ABCDEFG"],
        )


class Resources(unittest.TestCase):
    def set_res(self, cpu=None, mem=None):
        cfg = good()
        if cpu:
            cfg["resources"]["cpu"] = cpu
        if mem:
            cfg["resources"]["memory"] = mem
        return cfg

    def test_resources_shape(self):
        cfg = good()
        cfg["resources"] = []
        self.assertEqual(codes(cfg), [("resources", "wrong_type")])
        cfg["resources"] = {"cpu": {"request": "1", "limit": "2"}}
        self.assertEqual(codes(cfg), [("resources.memory", "missing")])
        cfg["resources"] = {"cpu": 5, "memory": {"request": "1Mi"}}
        self.assertEqual(codes(cfg), [("resources.cpu", "wrong_type"), ("resources.memory.limit", "missing")])
        cfg["resources"] = {"cpu": {"request": 1, "limit": "2"}, "memory": {"request": "1Mi", "limit": None}}
        self.assertEqual(codes(cfg), [("resources.cpu.request", "wrong_type"), ("resources.memory.limit", "wrong_type")])

    def test_cpu_forms(self):
        for req, lim in (("250m", "500m"), ("0.5", "1"), ("500m", "0.5"), ("1000m", "1"), ("0.25", "4"), ("1", "4000m")):
            self.assertEqual(deploycheck.validate(self.set_res(cpu={"request": req, "limit": lim})), [], (req, lim))
        for bad in ("0", "0m", "-1", "m", "1.5m", "1 core", "", "1e3", "250M"):
            errs = codes(self.set_res(cpu={"request": bad, "limit": "1"}))
            self.assertEqual(errs, [("resources.cpu.request", "invalid_quantity")], bad)

    def test_memory_forms(self):
        for req, lim in (("128Mi", "256Mi"), ("1Gi", "1024Mi"), ("512Mi", "2Gi"), ("1Mi", "8Gi")):
            self.assertEqual(deploycheck.validate(self.set_res(mem={"request": req, "limit": lim})), [], (req, lim))
        for bad in ("0Mi", "128", "1.5Gi", "128MB", "-1Mi", "Gi", "128mi"):
            errs = codes(self.set_res(mem={"request": "1Mi", "limit": bad}))
            self.assertEqual(errs, [("resources.memory.limit", "invalid_quantity")], bad)

    def test_request_vs_limit(self):
        self.assertEqual(codes(self.set_res(cpu={"request": "1", "limit": "500m"})), [("resources.cpu", "request_exceeds_limit")])
        self.assertEqual(codes(self.set_res(mem={"request": "2Gi", "limit": "1024Mi"})), [("resources.memory", "request_exceeds_limit")])
        self.assertEqual(deploycheck.validate(self.set_res(cpu={"request": "1", "limit": "1000m"})), [])
        # одна из величин не разобрана: сравнение не делается
        self.assertEqual(codes(self.set_res(cpu={"request": "x", "limit": "100m"})), [("resources.cpu.request", "invalid_quantity")])

    def test_limit_caps(self):
        self.assertEqual(deploycheck.validate(self.set_res(cpu={"request": "1", "limit": "4"}, mem={"request": "1Gi", "limit": "8Gi"})), [])
        self.assertEqual(codes(self.set_res(cpu={"request": "1", "limit": "4001m"})), [("resources.cpu.limit", "limit_too_high")])
        self.assertEqual(codes(self.set_res(mem={"request": "1Gi", "limit": "8193Mi"})), [("resources.memory.limit", "limit_too_high")])
        both = self.set_res(cpu={"request": "5", "limit": "6"}, mem={"request": "9Gi", "limit": "10Gi"})
        self.assertEqual(codes(both), [("resources.cpu.limit", "limit_too_high"), ("resources.memory.limit", "limit_too_high")])


class Files(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def write(self, text, bom=False, name="cfg.json"):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8-sig" if bom else "utf-8") as f:
            f.write(text)
        return path

    def test_validate_file(self):
        self.assertEqual(deploycheck.validate_file(self.write(json.dumps(GOOD), bom=True)), [])
        bad = good()
        bad["port"] = 70000
        errs = deploycheck.validate_file(self.write(json.dumps(bad)))
        self.assertEqual([(e["path"], e["code"]) for e in errs], [("port", "out_of_range")])

    def test_invalid_json_and_missing_file(self):
        errs = deploycheck.validate_file(self.write("{not json"))
        self.assertEqual([(e["path"], e["code"]) for e in errs], [("$", "invalid_json")])
        errs = deploycheck.validate_file(self.write("[1, 2]"))
        self.assertEqual([(e["path"], e["code"]) for e in errs], [("$", "not_object")])
        with self.assertRaises(FileNotFoundError):
            deploycheck.validate_file(os.path.join(self.dir, "nope.json"))

    def test_cli_exit_codes(self):
        here = os.path.dirname(os.path.abspath(deploycheck.__file__))
        script = os.path.join(here, "deploycheck.py")
        ok = subprocess.run([sys.executable, script, self.write(json.dumps(GOOD))], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        self.assertEqual(json.loads(ok.stdout), [])
        bad = good()
        bad["replicas"] = 99
        r = subprocess.run([sys.executable, script, self.write(json.dumps(bad), name="b.json")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertEqual([(e["path"], e["code"]) for e in json.loads(r.stdout)], [("replicas", "out_of_range")])

    def test_input_not_mutated(self):
        cfg = good()
        cfg["env"]["API_KEY"] = "x"
        before = copy.deepcopy(cfg)
        deploycheck.validate(cfg)
        self.assertEqual(cfg, before)


if __name__ == "__main__":
    unittest.main()
