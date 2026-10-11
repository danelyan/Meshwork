"""Валидатор конфигурации деплоя по контракту (contract.md)."""
import json
import re
import sys

REQUIRED = ("name", "image", "replicas", "port", "resources")
KNOWN = set(REQUIRED) | {"env"}
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
ENV_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
REF_RE = re.compile(r"^[a-z0-9-]+/[A-Za-z0-9_.-]+$")
SECRET_WORDS = ("PASSWORD", "TOKEN", "SECRET", "KEY")
CPU_RE = re.compile(r"^(\d+)m$")
CORES_RE = re.compile(r"^\d+(\.\d+)?$")
MEM_RE = re.compile(r"^(\d+)(Mi|Gi)$")


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _cpu(v):
    m = CPU_RE.match(v)
    if m:
        n = int(m.group(1))
    elif CORES_RE.match(v):
        n = round(float(v) * 1000)
    else:
        return None
    return n if n > 0 else None


def _mem(v):
    m = MEM_RE.match(v)
    if not m:
        return None
    n = int(m.group(1)) * (1024 if m.group(2) == "Gi" else 1)
    return n if n > 0 else None


def validate(config) -> list:
    errs = set()

    def add(path, code, msg):
        errs.add((path, code, msg))

    if not isinstance(config, dict):
        add("$", "not_object", "конфигурация должна быть объектом")
        return _out(errs)
    for k in config:
        if k not in KNOWN:
            add(k, "unknown_field", f"неизвестное поле {k}")
    for k in REQUIRED:
        if k not in config:
            add(k, "missing", f"нет обязательного поля {k}")

    if "name" in config:
        v = config["name"]
        if not isinstance(v, str):
            add("name", "wrong_type", "name должен быть строкой")
        elif not NAME_RE.match(v):
            add("name", "invalid_name", "name: строчные буквы, цифры и дефис, до 40 символов")
    if "image" in config:
        v = config["image"]
        if not isinstance(v, str):
            add("image", "wrong_type", "image должен быть строкой")
        else:
            repo, sep, tag = v.rpartition(":")
            if not sep or not repo or not tag or "/" in tag:
                add("image", "invalid_image", "image: <репозиторий>:<тег>")
            elif tag == "latest":
                add("image", "latest_tag", "тег latest запрещён")
    for key, lo, hi in (("replicas", 1, 20), ("port", 1, 65535)):
        if key in config:
            v = config[key]
            if not _is_int(v):
                add(key, "wrong_type", f"{key} должно быть целым")
            elif not lo <= v <= hi:
                add(key, "out_of_range", f"{key}: от {lo} до {hi}")

    if "env" in config:
        env = config["env"]
        if not isinstance(env, dict):
            add("env", "wrong_type", "env должен быть объектом")
        else:
            for name, v in env.items():
                p = f"env.{name}"
                if not ENV_RE.match(name):
                    add(p, "invalid_env_name", "имя переменной: A-Z, 0-9, _")
                if isinstance(v, str):
                    if any(w in name for w in SECRET_WORDS):
                        add(p, "plaintext_secret", "секрет в открытом виде, нужен secretRef")
                elif isinstance(v, dict):
                    ref = v.get("secretRef")
                    if set(v) != {"secretRef"} or not isinstance(ref, str) or not REF_RE.match(ref):
                        add(p, "invalid_secret_ref", 'ожидается {"secretRef": "хранилище/ключ"}')
                else:
                    add(p, "wrong_type", "значение: строка или объект secretRef")

    if "resources" in config:
        res = config["resources"]
        if not isinstance(res, dict):
            add("resources", "wrong_type", "resources должен быть объектом")
        else:
            for kind, parse, cap in (("cpu", _cpu, 4000), ("memory", _mem, 8192)):
                kp = f"resources.{kind}"
                if kind not in res:
                    add(kp, "missing", f"нет {kp}")
                    continue
                sec = res[kind]
                if not isinstance(sec, dict):
                    add(kp, "wrong_type", f"{kp} должен быть объектом")
                    continue
                vals = {}
                for part in ("request", "limit"):
                    pp = f"{kp}.{part}"
                    if part not in sec:
                        add(pp, "missing", f"нет {pp}")
                    elif not isinstance(sec[part], str):
                        add(pp, "wrong_type", f"{pp} должно быть строкой")
                    else:
                        n = parse(sec[part])
                        if n is None:
                            add(pp, "invalid_quantity", f"{pp}: неверная величина")
                        else:
                            vals[part] = n
                if len(vals) == 2 and vals["request"] > vals["limit"]:
                    add(kp, "request_exceeds_limit", "request больше limit")
                if "limit" in vals and vals["limit"] > cap:
                    add(f"{kp}.limit", "limit_too_high", f"{kp}.limit выше допустимого")
    return _out(errs)


def _out(errs):
    return [{"path": p, "code": c, "message": m} for p, c, m in sorted(errs, key=lambda e: (e[0], e[1]))]


def validate_file(path: str) -> list:
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    try:
        data = json.loads(text)
    except ValueError as e:
        return [{"path": "$", "code": "invalid_json", "message": f"не JSON: {e}"}]
    return validate(data)


if __name__ == "__main__":
    errors = validate_file(sys.argv[1])
    print(json.dumps(errors, ensure_ascii=False))
    sys.exit(1 if errors else 0)
