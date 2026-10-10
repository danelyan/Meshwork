"""ETL заказов CSV -> SQLite по контракту (contract.md)."""
import json
import sys


def run(csv_path: str, db_path: str) -> dict:
    raise NotImplementedError("TODO")


if __name__ == "__main__":
    print(json.dumps(run(sys.argv[1], sys.argv[2]), ensure_ascii=False))
