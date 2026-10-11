#!/usr/bin/env bash
# Применяет к работающему реалму настройки, которые импорт подхватывает только на пустой базе:
# тему страниц входа и список языков. Запускать на сервере из каталога симулятора (читает .env):
#   bash scripts/apply-realm-settings.sh
# Секреты и токены не печатает.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
KC="$PUBLIC_URL/auth"
TOKEN="$(curl -fsS "$KC/realms/master/protocol/openid-connect/token" -d grant_type=password -d client_id=admin-cli \
  --data-urlencode "username=${KC_BOOTSTRAP_ADMIN_USERNAME:-admin}" --data-urlencode "password=$KC_BOOTSTRAP_ADMIN_PASSWORD" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"
BODY="$(python3 -c 'import json; r=json.load(open("keycloak/fsp-id-realm.json")); print(json.dumps({k: r[k] for k in ("loginTheme","internationalizationEnabled","supportedLocales","defaultLocale")}))')"
code="$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$KC/admin/realms/fsp-id" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$BODY")"
echo "PUT realm fsp-id: $code – $BODY"
[ "$code" = 204 ]
