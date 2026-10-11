#!/usr/bin/env bash
# Локальный PostgreSQL 16 для разработки без Docker и без brew services.
# Кластер общий для всех лейнов: fsp/.pgdata (рядом с основным клоном), порт 54329, пользователь postgres, trust.
# Другое место – PGDATA_LOCAL=/путь (им же разрешается первичный initdb).
#   db-local.sh start | stop | status | create <dbname> | drop <dbname> | url <dbname>
set -euo pipefail
# macOS: без валидной локали postmaster падает «became multithreaded during startup».
export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"

PG_BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@16/bin}"
PORT="${PGPORT_LOCAL:-54329}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Корень кластера: fsp/.pgdata, где fsp/ – родитель основного клона (fsp/fsp-lct-2026).
# `git rev-parse --git-common-dir` общий и для основного клона, и для его worktree'ов (.wt/<lane>),
# поэтому путь не зависит от глубины, на которой лежит скрипт.
default_pgdata() {
  local common
  common="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  echo "$(dirname "$(dirname "$common")")/.pgdata"
}
if [ -n "${PGDATA_LOCAL:-}" ]; then
  PGDATA="$PGDATA_LOCAL"
else
  PGDATA="$(default_pgdata)" || { echo "Не удалось определить каталог кластера (скрипт вне git-репозитория). Задайте PGDATA_LOCAL=/путь/к/.pgdata" >&2; exit 3; }
fi
LOG="$PGDATA/server.log"

psql_admin() { "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }

valid_name() { [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "bad db name: $1 (a-z, 0-9, _)" >&2; exit 2; }; }

cmd="${1:-status}"
case "$cmd" in
  start)
    if [ ! -f "$PGDATA/PG_VERSION" ]; then
      # Не создавать кластер молча в неожиданном месте: только по явному PGDATA_LOCAL.
      if [ -z "${PGDATA_LOCAL:-}" ]; then
        echo "Кластер PostgreSQL не найден: $PGDATA" >&2
        echo "Чтобы создать его именно здесь, задайте PGDATA_LOCAL=$PGDATA; иначе укажите путь к существующему кластеру." >&2
        exit 3
      fi
      echo "initdb -> $PGDATA"
      "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
    fi
    if "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
      echo "already running on port $PORT"
    else
      "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$LOG" -w start
    fi
    ;;
  stop)
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop
    ;;
  status)
    "$PG_BIN/pg_ctl" -D "$PGDATA" status
    ;;
  create)
    name="${2:?usage: db-local.sh create <dbname>}"; valid_name "$name"
    if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname='$name'")" = "1" ]; then
      echo "exists: $name"
    else
      psql_admin -c "CREATE DATABASE \"$name\"" >/dev/null && echo "created: $name"
    fi
    echo "DATABASE_URL=postgresql://postgres@127.0.0.1:$PORT/$name"
    ;;
  drop)
    name="${2:?usage: db-local.sh drop <dbname>}"; valid_name "$name"
    psql_admin -c "DROP DATABASE IF EXISTS \"$name\" WITH (FORCE)" >/dev/null && echo "dropped: $name"
    ;;
  url)
    name="${2:?usage: db-local.sh url <dbname>}"; valid_name "$name"
    echo "postgresql://postgres@127.0.0.1:$PORT/$name"
    ;;
  *)
    echo "usage: $0 start|stop|status|create <db>|drop <db>|url <db>" >&2; exit 2
    ;;
esac
