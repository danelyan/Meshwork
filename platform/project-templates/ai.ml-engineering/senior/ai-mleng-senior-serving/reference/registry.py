"""Реестр версий модели и пакетный инференс (эталон)."""
import copy
import math


def _is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _validate_model(model):
    if not isinstance(model, dict):
        raise ValueError("model must be a dict")
    feats = model.get("features")
    if not isinstance(feats, list) or not feats or not all(isinstance(f, str) and f for f in feats) or len(set(feats)) != len(feats):
        raise ValueError("bad features")
    w = model.get("weights")
    if not isinstance(w, list) or len(w) != len(feats) or not all(_is_num(v) and math.isfinite(v) for v in w):
        raise ValueError("bad weights")
    b = model.get("bias")
    if not _is_num(b) or not math.isfinite(b):
        raise ValueError("bad bias")
    if "threshold" in model:
        t = model["threshold"]
        if not _is_num(t) or not (0 < t < 1):
            raise ValueError("bad threshold")
    return {"features": list(feats), "weights": list(w), "bias": b, **({"threshold": model["threshold"]} if "threshold" in model else {})}


def _sigmoid(z):
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z)) if z < 700 else 1.0
    e = math.exp(z) if z > -700 else 0.0
    return e / (1.0 + e)


class ModelRegistry:
    def __init__(self):
        self._models = {}
        self._active = None
        self._history = []  # предыдущие активные версии

    def register(self, version, model):
        if not isinstance(version, str) or not version:
            raise ValueError("version must be a non-empty string")
        clean = _validate_model(model)
        if version in self._models:
            if self._models[version] == clean:
                return
            raise ValueError(f"version {version!r} already registered with another model")
        self._models[version] = clean

    def activate(self, version, allow_schema_change=False):
        if version not in self._models:
            raise KeyError(version)
        if version == self._active:
            return
        if self._active is not None and not allow_schema_change:
            if set(self._models[version]["features"]) != set(self._models[self._active]["features"]):
                raise ValueError("incompatible feature schema")
        if self._active is not None:
            self._history.append(self._active)
        self._active = version

    def rollback(self):
        if not self._history:
            raise LookupError("nothing to roll back to")
        self._active = self._history.pop()
        return self._active

    def active_version(self):
        return self._active

    def versions(self):
        return list(self._models)

    def get_model(self, version):
        return copy.deepcopy(self._models[version])

    def predict_batch(self, rows, version=None):
        if version is None:
            if self._active is None:
                raise RuntimeError("no active version")
            version = self._active
        model = copy.deepcopy(self._models[version])
        feats, weights, bias = model["features"], model["weights"], model["bias"]
        thr = model.get("threshold", 0.5)
        results, n_ok = [], 0
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                results.append({"index": i, "ok": False, "error": "not_a_dict"})
                continue
            z, err = bias, None
            for f, w in zip(feats, weights):
                if f not in row:
                    err = f"missing_feature:{f}"
                    break
                v = row[f]
                if not _is_num(v) or not math.isfinite(v):
                    err = f"bad_value:{f}"
                    break
                z += w * v
            if err is None and not math.isfinite(z):
                err = "bad_value:" + feats[0]
            if err:
                results.append({"index": i, "ok": False, "error": err})
                continue
            s = _sigmoid(z)
            results.append({"index": i, "ok": True, "score": s, "label": 1 if s >= thr else 0})
            n_ok += 1
        return {"version": version, "results": results, "n_ok": n_ok, "n_failed": len(results) - n_ok}

    def export_state(self):
        return copy.deepcopy({"models": self._models, "order": list(self._models), "active": self._active, "history": self._history})

    @classmethod
    def from_state(cls, state):
        try:
            order, models = list(state["order"]), state["models"]
            active, history = state["active"], list(state["history"])
            if set(order) != set(models) or len(order) != len(set(order)):
                raise ValueError("order and models disagree")
            reg = cls()
            for v in order:
                reg.register(v, copy.deepcopy(models[v]))
        except (KeyError, TypeError) as e:
            raise ValueError(f"bad state: {e}") from e
        if (active is not None and active not in reg._models) or any(h not in reg._models for h in history):
            raise ValueError("unknown version in state")
        if active is None and history:
            raise ValueError("history without active version")
        reg._active, reg._history = active, history
        return reg
