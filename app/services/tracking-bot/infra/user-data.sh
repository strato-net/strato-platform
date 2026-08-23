#!/bin/bash
# cloud-init user data for the tracking-bot EC2 host (Ubuntu 24.04):
# docker engine + compose plugin, a deploy directory, and nothing else. The
# bot itself (image build, .env with secrets) is pushed by infra/deploy-bot.sh
# over SSH so no secret ever passes through instance metadata.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git rsync
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
usermod -aG docker ubuntu
mkdir -p /opt/tracking-bot
chown ubuntu:ubuntu /opt/tracking-bot
# Keep docker's disk usage bounded: prune dangling build cache nightly
cat > /etc/cron.daily/docker-prune <<'CRON'
#!/bin/sh
docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
docker image prune -f --filter until=168h >/dev/null 2>&1 || true
CRON
chmod +x /etc/cron.daily/docker-prune
touch /opt/tracking-bot/.provisioned
