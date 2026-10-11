#!/usr/bin/env bash
# Создаёт облачный сервер под симулятор в проекте Selectel `fsp-lct-2026` (пул ru-7, зона ru-7a):
# загрузочный сетевой диск из образа Ubuntu 24.04, сервер PRC50.2-4096 в сети fsp-net с группой
# безопасности fsp-stand (22/80/443) и плавающим адресом. Печатает адрес; секреты не выводит.
#
#   SELECTEL_API_KEY=… PUBKEY="$(cat ~/.ssh/fsp-id.pub)" bash scripts/selectel-server.sh
#   На macOS без SELECTEL_API_KEY ключ берётся из Keychain: security find-generic-password -s SELECTEL_API_KEY -w
#
# Идентификаторы ниже сняты с проекта 2026-10-10 (docs/deploy.md); при смене проекта — обновить.
set -euo pipefail

PROJECT_ID="${SELECTEL_PROJECT_ID:-742c1289e92f460095accfdded8a2799}"
REGION="${SELECTEL_REGION_BASE:-https://ru-7.cloud.api.selcloud.ru}"
AZ="${SELECTEL_AZ:-ru-7a}"
FLAVOR="${SELECTEL_FLAVOR:-9054}"                                         # PRC50.2-4096: 2 vCPU (50 %), 4 ГБ
IMAGE="${SELECTEL_IMAGE:-c52e09ea-179a-47cb-a979-1ab234f194fa}"          # Ubuntu 24.04 LTS 64-bit
NETWORK="${SELECTEL_NETWORK:-975cb3b8-d4d7-4f29-ba71-883b9825c18d}"      # fsp-net
EXT_NET="${SELECTEL_EXT_NET:-b2907e0d-10d5-4a9d-a1e7-65913fedce1d}"      # external-network
SECGROUP="${SELECTEL_SECGROUP:-fsp-stand}"
VOLUME_TYPE="${SELECTEL_VOLUME_TYPE:-basicssd.ru-7a}"
DISK_GB="${SELECTEL_DISK_GB:-30}"
NAME="${SERVER_NAME:-fsp-id}"
: "${PUBKEY:?PUBKEY — открытый ключ SSH для root}"

if [ -z "${SELECTEL_API_KEY:-}" ]; then
  SELECTEL_API_KEY="$(security find-generic-password -s SELECTEL_API_KEY -w)"
fi

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

TOKEN_JSON="$(printf 'header = "X-Token: %s"\n' "$SELECTEL_API_KEY" | curl -sS -K - -X POST https://api.selectel.ru/vpc/resell/v2/tokens \
  -H 'Content-Type: application/json' -d "{\"token\":{\"project_id\":\"$PROJECT_ID\"}}")"
TOKEN="$(printf '%s' "$TOKEN_JSON" | json 'd["token"]["id"]')"
unset SELECTEL_API_KEY
cleanup() { printf 'header = "X-Auth-Token: %s"\n' "$TOKEN" | curl -s -o /dev/null -K - -X DELETE "https://api.selectel.ru/vpc/resell/v2/tokens/$TOKEN" || true; }
trap cleanup EXIT

os() { # os METHOD PATH [JSON]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    printf 'header = "X-Auth-Token: %s"\n' "$TOKEN" | curl -sS -K - -X "$method" "$REGION$path" -H 'Content-Type: application/json' -d "$body"
  else
    printf 'header = "X-Auth-Token: %s"\n' "$TOKEN" | curl -sS -K - -X "$method" "$REGION$path"
  fi
}

# Повторный запуск не должен создать второй сервер.
if os GET /compute/v2.1/servers | json "any(s['name']=='$NAME' for s in d['servers'])" | grep -q True; then
  echo "Сервер $NAME уже существует — выхожу" >&2
  exit 2
fi

echo "keypair $NAME-admin"
os POST /compute/v2.1/os-keypairs "{\"keypair\":{\"name\":\"$NAME-admin\",\"public_key\":\"$PUBKEY\"}}" >/dev/null || true

echo "volume $NAME-boot ($DISK_GB ГБ, $VOLUME_TYPE) из образа"
VOL_ID="$(os POST /volume/v3/volumes "{\"volume\":{\"name\":\"$NAME-boot\",\"size\":$DISK_GB,\"imageRef\":\"$IMAGE\",\"volume_type\":\"$VOLUME_TYPE\",\"availability_zone\":\"$AZ\"}}" | json 'd["volume"]["id"]')"
for _ in $(seq 1 60); do
  st="$(os GET "/volume/v3/volumes/$VOL_ID" | json 'd["volume"]["status"]')"
  [ "$st" = available ] && break
  [ "$st" = error ] && { echo "диск в состоянии error" >&2; exit 1; }
  sleep 5
done
echo "volume: $VOL_ID ($st)"

echo "server $NAME (flavor $FLAVOR, $AZ)"
SERVER_ID="$(os POST /compute/v2.1/servers "{\"server\":{\"name\":\"$NAME\",\"flavorRef\":\"$FLAVOR\",\"key_name\":\"$NAME-admin\",\"availability_zone\":\"$AZ\",\"networks\":[{\"uuid\":\"$NETWORK\"}],\"security_groups\":[{\"name\":\"$SECGROUP\"}],\"block_device_mapping_v2\":[{\"boot_index\":0,\"uuid\":\"$VOL_ID\",\"source_type\":\"volume\",\"destination_type\":\"volume\",\"delete_on_termination\":true}]}}" | json 'd["server"]["id"]')"
for _ in $(seq 1 60); do
  st="$(os GET "/compute/v2.1/servers/$SERVER_ID" | json 'd["server"]["status"]')"
  [ "$st" = ACTIVE ] && break
  [ "$st" = ERROR ] && { echo "сервер в состоянии ERROR" >&2; exit 1; }
  sleep 5
done
echo "server: $SERVER_ID ($st)"

PORT_ID="$(os GET "/network/v2.0/ports?device_id=$SERVER_ID" | json 'd["ports"][0]["id"]')"
SG_ID="$(os GET "/network/v2.0/security-groups?name=$SECGROUP" | json 'd["security_groups"][0]["id"]')"
os PUT "/network/v2.0/ports/$PORT_ID" "{\"port\":{\"security_groups\":[\"$SG_ID\"]}}" >/dev/null
echo "port $PORT_ID: security group $SECGROUP"

FIP="$(os POST /network/v2.0/floatingips "{\"floatingip\":{\"floating_network_id\":\"$EXT_NET\",\"port_id\":\"$PORT_ID\"}}" | json 'd["floatingip"]["floating_ip_address"]')"
echo "floating ip: $FIP"
echo "sslip: $(printf '%s' "$FIP" | tr . -).sslip.io"
echo "ssh -i ~/.ssh/$NAME root@$FIP"
