#!/usr/bin/env bash
# Двухчасовой замер LLM по research/12 § 6.2: смоук → диалоги консультанта → извлечение боевым промптом.
# Запуск из platform/: bash eval/llm-bench/protocol.sh [модели]   (по умолчанию alice,giga,deepseek)
# Ключи – в platform/.env.bench (не в git), список переменных – eval/llm-bench/README.md.
# Шаги идут последовательно: машина слабая, а провайдер Yandex держит 10 синхронных генераций на каталог.
set -euo pipefail
cd "$(dirname "$0")/../.."
MODELS="${1:-alice,giga,deepseek}"
if [ -f .env.bench ]; then set -a; . ./.env.bench; set +a; fi

echo "== 1/3 смоук: tools, json_schema, возврат результата инструмента (≈1 мин) =="
npx tsx eval/llm-bench/run.ts --smoke --models "$MODELS"

echo "== 2/3 диалоги: 10 резюме × 3 повтора + нагрузка 10 одновременных (≈40–60 мин) =="
npx tsx eval/llm-bench/run.ts --models "$MODELS" --repeats 3

echo "== 3/3 боевой извлекатель: P/R/F1, JSON-ошибки, латентность, стоимость (≈15–30 мин) =="
npx tsx eval/llm-bench/compare.ts --models "$MODELS" --repeats 1

echo "Готово: таблицы – eval/results/llm-compare-*.md, сырые прогоны – eval/results/llm-bench-*.json"
