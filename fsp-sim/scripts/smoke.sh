#!/usr/bin/env bash
# Проверка живого симулятора: токены из Keycloak и ответы API.
#   PUBLIC_URL=https://… FSP_PARTNER_DEMO_SECRET=… FSP_CAREER_CLIENT_SECRET=… FSP_DEMO_PASSWORD=… bash scripts/smoke.sh
# Печатает только коды ответов и короткие поля; секреты и токены не выводит.
set -euo pipefail
: "${PUBLIC_URL:?PUBLIC_URL}"
PARTNER_SECRET="${FSP_PARTNER_DEMO_SECRET:-fsp-partner-demo-secret}"
CAREER_SECRET="${FSP_CAREER_CLIENT_SECRET:-fsp-career-demo-secret}"
PASSWORD="${FSP_DEMO_PASSWORD:-fsp-demo-2026}"
TOKEN_URL="$PUBLIC_URL/auth/realms/fsp-id/protocol/openid-connect/token"
API="$PUBLIC_URL/api/v1"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
field() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }
FAILED=0
# expect <что> <ожидаемый код> <curl-аргументы…>: печатает код и помечает расхождение.
expect() {
  local what="$1" want="$2"; shift 2
  local got; got="$(code "$@")"
  if [ "$got" = "$want" ]; then echo "$what: $got"; else echo "$what: $got (ожидалось $want) – FAIL"; FAILED=1; fi
}

expect "discovery" 200 "$PUBLIC_URL/auth/realms/fsp-id/.well-known/openid-configuration"
HEALTH="$(curl -s "$API/health")"
echo "health: $(printf '%s' "$HEALTH" | field 'd["data"]["ok"], d["data"]["idp"], d["data"]["athletes"], d["data"]["achievements"]')"
printf '%s' "$HEALTH" | field 'd["data"]["ok"] and d["data"]["idp"]=="up"' | grep -q True || { echo "health: idp не up – FAIL"; FAILED=1; }
expect "landing" 200 "$PUBLIC_URL/"
expect "docs" 200 "$PUBLIC_URL/docs"
expect "openapi" 200 "$PUBLIC_URL/openapi.json"
expect "events (public)" 200 "$API/events?per_page=2"
expect "me without token" 401 "$API/me"

ATHLETE_TOKEN=$(curl -s "$TOKEN_URL" -d grant_type=password -d client_id=fsp-career --data-urlencode "client_secret=$CAREER_SECRET" \
  -d username=fsp-10001 --data-urlencode "password=$PASSWORD" | field 'd.get("access_token","")')
[ -n "$ATHLETE_TOKEN" ] || { echo "athlete token: FAIL"; exit 1; }
echo "athlete token: ok"
ME="$(curl -s "$API/me" -H "Authorization: Bearer $ATHLETE_TOKEN")"
echo "me: $(printf '%s' "$ME" | field 'd["data"]["fsp_id"], d["data"]["display_name"], d["data"]["achievements_total"]')"
printf '%s' "$ME" | field 'd["data"]["fsp_id"]=="FSP-10001"' | grep -q True || { echo "me: не FSP-10001 – FAIL"; FAILED=1; }
expect "me/achievements" 200 "$API/me/achievements" -H "Authorization: Bearer $ATHLETE_TOKEN"
echo "me/consents: $(curl -s "$API/me/consents" -H "Authorization: Bearer $ATHLETE_TOKEN" | field '[c["client_id"] for c in d["data"]]')"

PARTNER_TOKEN=$(curl -s "$TOKEN_URL" -d grant_type=client_credentials -d client_id=fsp-partner-demo --data-urlencode "client_secret=$PARTNER_SECRET" | field 'd.get("access_token","")')
[ -n "$PARTNER_TOKEN" ] || { echo "partner token: FAIL"; exit 1; }
echo "partner token: ok"
echo "athletes (partner-demo): $(curl -s "$API/athletes?per_page=3" -H "Authorization: Bearer $PARTNER_TOKEN" | field 'd["meta"]["total"], d["meta"]["client_id"]')"
# Исходно FSP-10001 согласия demo-партнёру не давал (набор данных детерминирован): 403 → согласие → 200 → отзыв → 403.
expect "athlete FSP-10001 for partner-demo (no consent)" 403 "$API/athletes/FSP-10001" -H "Authorization: Bearer $PARTNER_TOKEN"
expect "grant consent to partner-demo" 200 -X PUT "$API/me/consents/fsp-partner-demo" -H "Authorization: Bearer $ATHLETE_TOKEN" -H 'content-type: application/json' -d '{"scopes":["profile","achievements"]}'
expect "athlete FSP-10001 for partner-demo (after consent)" 200 "$API/athletes/FSP-10001" -H "Authorization: Bearer $PARTNER_TOKEN"
expect "ranks without ranks scope" 403 "$API/athletes/FSP-10001/ranks" -H "Authorization: Bearer $PARTNER_TOKEN"
expect "revoke consent" 204 -X DELETE "$API/me/consents/fsp-partner-demo" -H "Authorization: Bearer $ATHLETE_TOKEN"
expect "athlete FSP-10001 for partner-demo (after revoke)" 403 "$API/athletes/FSP-10001" -H "Authorization: Bearer $PARTNER_TOKEN"
expect "partner token to /me" 403 "$API/me" -H "Authorization: Bearer $PARTNER_TOKEN"

CAREER_TOKEN=$(curl -s "$TOKEN_URL" -d grant_type=client_credentials -d client_id=fsp-career --data-urlencode "client_secret=$CAREER_SECRET" | field 'd.get("access_token","")')
[ -n "$CAREER_TOKEN" ] || { echo "fsp-career token: FAIL"; exit 1; }
echo "athletes (fsp-career): $(curl -s "$API/athletes?per_page=1" -H "Authorization: Bearer $CAREER_TOKEN" | field 'd["meta"]["total"]')"
expect "FSP-10001 achievements for fsp-career" 200 "$API/athletes/FSP-10001/achievements" -H "Authorization: Bearer $CAREER_TOKEN"
expect "garbage token" 401 "$API/me" -H "Authorization: Bearer not-a-jwt"
# Песочница стенда: участник, созданный вручную, входит через ФСП ID, его достижение видно в API;
# после удаления войти им нельзя. За собой проверка всё убирает.
expect "start page script" 200 "$PUBLIC_URL/assets/app.js"
NEW="$(curl -s -X POST "$API/sandbox/athletes" -H 'content-type: application/json' \
  -d '{"last_name":"Проверкин","first_name":"Смок","birth_year":2000,"region_code":"77","disciplines":["product"]}')"
NEW_ID="$(printf '%s' "$NEW" | field 'd.get("data",{}).get("athlete",{}).get("fsp_id","")')"
NEW_LOGIN="$(printf '%s' "$NEW" | field 'd.get("data",{}).get("login",{}).get("username","")')"
if [ -z "$NEW_ID" ]; then
  echo "sandbox create athlete: FAIL ($(printf '%s' "$NEW" | field 'd.get("error",{}).get("code")'))"; FAILED=1
else
  echo "sandbox create athlete: $NEW_ID ($NEW_LOGIN)"
  expect "sandbox add achievement" 201 -X POST "$API/sandbox/athletes/$NEW_ID/achievements" -H 'content-type: application/json' \
    -d '{"event":{"name":"Проверочный хакатон стенда","discipline":"product","kind":"hackathon","date":"2026-10-01","entrants_total":10},"place":1}'
  demo_token() { curl -s "$TOKEN_URL" -d grant_type=password -d client_id=fsp-athlete-demo -d "username=$NEW_LOGIN" --data-urlencode "password=$PASSWORD" | field 'd.get("access_token","")'; }
  NEW_TOKEN="$(demo_token)"
  if [ -n "$NEW_TOKEN" ]; then
    echo "sandbox athlete token (fsp-athlete-demo): ok"
    MINE="$(curl -s "$API/me/achievements" -H "Authorization: Bearer $NEW_TOKEN" | field '[a["event_name"] for a in d.get("data",[])]')"
    echo "sandbox me/achievements: $MINE"
    [ "$MINE" = "['Проверочный хакатон стенда']" ] || { echo "sandbox me/achievements: не та запись – FAIL"; FAILED=1; }
  else
    echo "sandbox athlete token: FAIL"; FAILED=1
  fi
  expect "sandbox delete athlete" 204 -X DELETE "$API/sandbox/athletes/$NEW_ID"
  [ -z "$(demo_token)" ] && echo "deleted athlete cannot sign in: ok" || { echo "deleted athlete still signs in – FAIL"; FAILED=1; }
  echo "sandbox changes after cleanup: $(curl -s "$API/sandbox/meta" | field 'd["data"]["changes"]["manual_athletes"], d["data"]["changes"]["manual_achievements"]')"
fi
curl -s -I "$API/disciplines" | grep -qi '^x-fsp-simulator: true' && echo "simulator header: ok" || { echo "simulator header: отсутствует – FAIL"; FAILED=1; }
if [ "$FAILED" -ne 0 ]; then echo "smoke: FAIL"; exit 1; fi
echo "smoke: OK"
