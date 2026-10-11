#!/usr/bin/env bash
# Выкладка симулятора на сервер: rsync каталога fsp-sim/ и docker compose up. Запускать из fsp-sim/:
#   DEPLOY_HOST=deploy@203.0.113.10 bash scripts/deploy.sh
# .env на сервере не трогается (его создаёт первый деплой из .env.example — значения заменить вручную).
set -euo pipefail
: "${DEPLOY_HOST:?DEPLOY_HOST — user@host}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/fsp/fsp-sim}"
SSH_OPTS="${SSH_OPTS:-}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck disable=SC2086
rsync -az --delete -e "ssh $SSH_OPTS" \
  --exclude node_modules --exclude dist --exclude .env --exclude tests --exclude '.git*' \
  "$HERE/" "$DEPLOY_HOST:$DEPLOY_PATH/"

# shellcheck disable=SC2086
ssh $SSH_OPTS "$DEPLOY_HOST" bash -s <<REMOTE
set -euo pipefail
cd "$DEPLOY_PATH"
if [ ! -f .env ]; then
  umask 077
  cp .env.example .env
  echo "Создан .env из .env.example — задайте PUBLIC_URL и пароли, затем повторите деплой" >&2
  exit 3
fi
docker compose up -d --build --remove-orphans
docker builder prune -f --max-used-space 2gb >/dev/null 2>&1 || true
set -a; . ./.env; set +a
for i in \$(seq 1 60); do
  code=\$(curl -s -o /dev/null -w '%{http_code}' "\$PUBLIC_URL/api/v1/health" || true)
  [ "\$code" = 200 ] && { echo "health: 200 (\$PUBLIC_URL)"; exit 0; }
  sleep 5
done
echo "health не ответил 200 за 5 минут" >&2
docker compose ps
exit 1
REMOTE
