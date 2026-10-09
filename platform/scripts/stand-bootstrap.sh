#!/usr/bin/env bash
# Подготовка чистого сервера Ubuntu 24.04 под стенд: Docker Engine, пользователь деплоя,
# каталог приложения, swap, файрвол и стартовый .env демо-режима без ключей.
# Запуск от root, идемпотентен:
#   DEPLOY_PUBKEY='ssh-ed25519 AAAA… deploy' STAND_DOMAIN=stand.example.ru bash stand-bootstrap.sh
# Дальше — docs/deploy.md.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/fsp/platform}"
: "${DEPLOY_PUBKEY:?задайте DEPLOY_PUBKEY — открытый ключ, с которым ходит деплой}"
: "${STAND_DOMAIN:?задайте STAND_DOMAIN — домен стенда, например 203-0-113-10.sslip.io}"

[ "$(id -u)" -eq 0 ] || { echo "Нужен root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl openssl rsync ufw

# Docker Engine из репозитория Docker (docs.docker.com/engine/install/ubuntu).
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  codename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Журналы контейнеров не должны занять весь диск.
if [ ! -f /etc/docker/daemon.json ]; then
  printf '%s\n' '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' > /etc/docker/daemon.json
  systemctl restart docker
fi

# Сборка Next.js на небольшом сервере упирается в память — подстраховка swap-файлом.
if [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Пользователь деплоя: без sudo, но в группе docker (это равносильно root на этом сервере).
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
ssh_dir="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/.ssh"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ssh_dir"
touch "$ssh_dir/authorized_keys"
grep -qxF "$DEPLOY_PUBKEY" "$ssh_dir/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "$ssh_dir/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$ssh_dir/authorized_keys"
chmod 600 "$ssh_dir/authorized_keys"

install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH"

# Стартовый .env: демо без ключей (platform/README.md, «Запуск демо без ключей»).
# Существующий файл не трогаем — в нём могут быть ключи модели и Яндекс ID.
if [ ! -f "$DEPLOY_PATH/.env" ]; then
  umask 077
  cat > "$DEPLOY_PATH/.env" <<EOF
SITE_ADDRESS=$STAND_DOMAIN
APP_URL=https://$STAND_DOMAIN
SESSION_SECRET=$(openssl rand -hex 32)
DEMO_LOGIN=true
LLM_PROVIDER=stub
LLM_STUB_DEMO=true
COLLECTOR_FIXTURES=true
TEST_DEMO_INTERVALS=true
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_PATH/.env"
fi

# Опубликованные Docker порты (80/443) идут мимо ufw; правило нужно для SSH и на случай запуска без Docker.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443
ufw --force enable

echo "Готово: $DEPLOY_USER@$(hostname), каталог $DEPLOY_PATH, домен $STAND_DOMAIN"
