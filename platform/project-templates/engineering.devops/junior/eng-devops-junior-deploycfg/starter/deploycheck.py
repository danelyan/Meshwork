"""Валидатор конфигурации деплоя по контракту (contract.md)."""
import json
import sys


def validate(config) -> list:
    raise NotImplementedError("TODO")


def validate_file(path: str) -> list:
    raise NotImplementedError("TODO")


if __name__ == "__main__":
    errors = validate_file(sys.argv[1])
    print(json.dumps(errors, ensure_ascii=False))
    sys.exit(1 if errors else 0)
