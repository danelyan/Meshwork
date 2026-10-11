"""Реестр моделей (эталон)."""
import copy
import json
import math
import os
from datetime import datetime, timezone

STAGES = ("staging", "production", "archived")


class TransitionError(Exception):
    pass


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class ModelRegistry:
    def __init__(self, path=None, clock=None):
        self._path = path
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._models = {}
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                try:
                    data = json.load(f)
                except json.JSONDecodeError as e:
                    raise ValueError(f"битый файл реестра: {e}") from e
            self._models = data.get("models", {})

    def _save(self):
        if not self._path:
            return
        tmp = self._path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"models": self._models}, f)
        os.replace(tmp, self._path)

    def _find(self, name, version):
        versions = self._models.get(name)
        if not versions or not isinstance(version, int) or isinstance(version, bool) or not 1 <= version <= len(versions):
            raise KeyError(f"{name}:{version}")
        return versions[version - 1]

    def register(self, name, metrics, params=None):
        if not isinstance(name, str) or not name:
            raise ValueError("name")
        if not isinstance(metrics, dict) or not metrics:
            raise ValueError("metrics")
        for k, v in metrics.items():
            if not isinstance(k, str) or not _is_number(v):
                raise ValueError("metrics")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise ValueError("params")
        versions = self._models.setdefault(name, [])
        rec = {
            "name": name,
            "version": len(versions) + 1,
            "stage": "staging",
            "metrics": copy.deepcopy(metrics),
            "params": copy.deepcopy(params),
            "created_at": self._clock().isoformat(),
        }
        versions.append(rec)
        self._save()
        return copy.deepcopy(rec)

    def get(self, name, version):
        return copy.deepcopy(self._find(name, version))

    def list_versions(self, name, stage=None):
        if stage is not None and stage not in STAGES:
            raise ValueError("stage")
        return [copy.deepcopy(r) for r in self._models.get(name, []) if stage is None or r["stage"] == stage]

    def promote(self, name, version, stage):
        if stage not in STAGES:
            raise ValueError("stage")
        rec = self._find(name, version)
        if rec["stage"] == "archived":
            raise TransitionError("archived – конечная стадия")
        if rec["stage"] == stage:
            raise TransitionError("уже в этой стадии")
        if stage == "production":
            for other in self._models[name]:
                if other["stage"] == "production":
                    other["stage"] = "archived"
        rec["stage"] = stage
        self._save()
        return copy.deepcopy(rec)

    def production(self, name):
        for r in self._models.get(name, []):
            if r["stage"] == "production":
                return copy.deepcopy(r)
        return None

    def best(self, name, metric, higher_is_better=True, stages=None):
        pool = [
            r for r in self._models.get(name, [])
            if metric in r["metrics"] and (r["stage"] in stages if stages is not None else r["stage"] != "archived")
        ]
        if not pool:
            return None
        sign = 1 if higher_is_better else -1
        winner = max(pool, key=lambda r: (sign * r["metrics"][metric], r["version"]))
        return copy.deepcopy(winner)
