#!/usr/bin/env bash
# One-time host setup for the tracking-bot EC2 instance (Amazon Linux 2023 or
# Ubuntu): docker engine + compose plugin, git, a swap file (the bot host is
# small), and /opt/tracking-bot. Idempotent; run as the login user with sudo.
set -euo pipefail
. /etc/os-release
USER_NAME=$(id -un)

if [ "${ID:-}" = "amzn" ]; then
  sudo dnf install -y -q docker git rsync >/dev/null
  # compose v2 is not packaged on AL2023: install the plugin binary
  ARCH=$(uname -m); [ "$ARCH" = "aarch64" ] && ARCH=aarch64 || ARCH=x86_64
  # AL2023's docker-buildx-plugin is too old for compose v5 (needs buildx >= 0.17): install both plugins from GitHub
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  if ! docker buildx version 2>/dev/null | grep -qE 'v0\.(1[7-9]|[2-9][0-9])|v[1-9]\.'; then
    BVER=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest | sed -nE 's/.*"tag_name": *"v?([^"]+)".*/\1/p' | head -1)
    BARCH=$([ "$ARCH" = "aarch64" ] && echo arm64 || echo amd64)
    sudo curl -fsSL "https://github.com/docker/buildx/releases/download/v${BVER}/buildx-v${BVER}.linux-${BARCH}" -o /usr/local/lib/docker/cli-plugins/docker-buildx
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
  fi
  if ! docker compose version >/dev/null 2>&1; then
    VER=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | sed -nE 's/.*"tag_name": *"v?([^"]+)".*/\1/p' | head -1)
    sudo curl -fsSL "https://github.com/docker/compose/releases/download/v${VER}/docker-compose-linux-${ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
elif [ "${ID:-}" = "ubuntu" ]; then
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -q
  sudo apt-get install -y -q ca-certificates curl gnupg git rsync
  if ! command -v docker >/dev/null; then
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    sudo apt-get update -q
    sudo apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
else
  echo "unsupported distro: ${ID:-?}"; exit 1
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER_NAME"

# Swap: image builds and npm ci need more than the small instance's RAM
if ! sudo swapon --show | grep -q /swapfile; then
  SWAP_GB=${SWAP_GB:-2}
  sudo fallocate -l "${SWAP_GB}G" /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_GB * 1024)) status=none
  sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# Bounded docker disk usage
sudo tee /etc/cron.daily/docker-prune >/dev/null <<'CRON'
#!/bin/sh
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
docker image prune -f --filter until=168h >/dev/null 2>&1 || true
CRON
sudo chmod +x /etc/cron.daily/docker-prune

sudo mkdir -p /opt/tracking-bot
sudo chown "$USER_NAME:$USER_NAME" /opt/tracking-bot
touch /opt/tracking-bot/.provisioned
echo "host ready: $(docker --version), $(docker compose version), swap: $(swapon --show --noheadings | awk '{print $3}' | head -1)"
