#!/usr/bin/env bash
# Две строки из stdin: Client ID, Client secret. Значения не попадают в argv и журнал.
# Запускать под замком деплоя, затем пересоздать только app (docs/deploy.md).
set +x
set -euo pipefail

env_file="${1:-.env}"
fail() { echo "$1" >&2; exit 1; }

[[ -f "$env_file" && ! -L "$env_file" ]] || fail 'Expected an existing regular .env file'
IFS= read -r client_id || fail 'Missing YANDEX_CLIENT_ID'
IFS= read -r client_secret || fail 'Missing YANDEX_CLIENT_SECRET'
[[ "$client_id" =~ ^[a-f0-9]{32}$ ]] || fail 'Invalid YANDEX_CLIENT_ID format'
[[ "$client_secret" =~ ^[A-Za-z0-9_-]+$ && ${#client_secret} -ge 16 && ${#client_secret} -le 256 ]] || fail 'Invalid YANDEX_CLIENT_SECRET format'

# Временный файл на той же файловой системе: mv заменяет .env атомарно.
# Остальные строки, включая настройки модели, SMTP и базы, сохраняются.
umask 077
temp_env="$(mktemp "${env_file}.yandex.XXXXXX")"
trap 'rm -f "$temp_env"' EXIT
awk '!/^[[:space:]]*(export[[:space:]]+)?YANDEX_CLIENT_(ID|SECRET)[[:space:]]*=/' "$env_file" > "$temp_env"
printf 'YANDEX_CLIENT_ID=%s\nYANDEX_CLIENT_SECRET=%s\n' "$client_id" "$client_secret" >> "$temp_env"
chmod 600 "$temp_env"
mv -f -- "$temp_env" "$env_file"
echo 'Yandex OAuth configuration updated'
