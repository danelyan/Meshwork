#!/usr/bin/env bash
# Подготовка чистого Ubuntu 24.04 под симулятор: Docker Engine, пользователь deploy, каталог,
# swap, ufw. Запуск от root, идемпотентен:
#   DEPLOY_PUBKEY='ssh-ed25519 AAAA… deploy' bash bootstrap-server.sh
# Дальше – scripts/deploy.sh с рабочей машины.
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/fsp/fsp-sim}"
: "${DEPLOY_PUBKEY:?задайте DEPLOY_PUBKEY – открытый ключ, с которым ходит деплой}"
[ "$(id -u)" -eq 0 ] || { echo "Нужен root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends ca-certificates curl openssl rsync ufw

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

if [ ! -f /etc/docker/daemon.json ]; then
  printf '%s\n' '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' > /etc/docker/daemon.json
  systemctl restart docker
fi

# Keycloak на старте и сборка образа API требуют памяти – swap как подстраховка.
if [ "$(swapon --noheadings | wc -l)" -eq 0 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
ssh_dir="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/.ssh"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$ssh_dir"
touch "$ssh_dir/authorized_keys"
grep -qxF "$DEPLOY_PUBKEY" "$ssh_dir/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "$ssh_dir/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$ssh_dir/authorized_keys"
chmod 600 "$ssh_dir/authorized_keys"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH"

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443
ufw --force enable

echo "Готово: $DEPLOY_USER@$(hostname), каталог $DEPLOY_PATH"
