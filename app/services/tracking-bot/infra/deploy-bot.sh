#!/usr/bin/env bash
# Push the bot to its EC2 host and (re)start it.
#   infra/deploy-bot.sh setup     install docker/git/swap on the host (once)
#   infra/deploy-bot.sh up        rsync source + .env, docker compose up -d --build
#   infra/deploy-bot.sh logs      follow bot logs
#   infra/deploy-bot.sh status    curl the bot's /status
#   infra/deploy-bot.sh restart   docker compose restart
#   infra/deploy-bot.sh ssh       interactive shell
# Reads infra/instance.local.json (written by provision.ts) for host + key,
# or BOT_HOST / BOT_SSH_KEY / BOT_SSH_USER env overrides. The env file pushed
# to the host is infra/bot.env (gitignored) unless BOT_ENV_FILE is set.
set -euo pipefail
cd "$(dirname "$0")/.."

INFO=infra/instance.local.json
if [ -f "$INFO" ]; then
  HOST=${BOT_HOST:-$(python3 -c "import json;print(json.load(open('$INFO'))['publicIp'])")}
  KEY=${BOT_SSH_KEY:-$(python3 -c "import json;print(json.load(open('$INFO'))['keyPath'])")}
  USER=${BOT_SSH_USER:-$(python3 -c "import json;print(json.load(open('$INFO')).get('sshUser','ubuntu'))")}
else
  HOST=${BOT_HOST:?set BOT_HOST or run provision first}
  KEY=${BOT_SSH_KEY:?set BOT_SSH_KEY}
  USER=${BOT_SSH_USER:-ubuntu}
fi
KEY=${KEY/#\~/$HOME}
ENV_FILE=${BOT_ENV_FILE:-infra/bot.env}
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 "$USER@$HOST")

case "${1:-up}" in
  setup)
    "${SSH[@]}" 'bash -s' < infra/setup-host.sh
    ;;
  up)
    [ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE (copy .env.example and fill it in)"; exit 1; }
    "${SSH[@]}" 'test -f /opt/tracking-bot/.provisioned' || { echo "host not set up yet: run $0 setup"; exit 1; }
    rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" \
      --exclude node_modules --exclude dist --exclude .env --exclude .provisioned --exclude tracking-server.pem --exclude 'infra/*.pem' --exclude 'infra/*.local.json' --exclude 'infra/bot.env' \
      ./ "$USER@$HOST:/opt/tracking-bot/"
    scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$ENV_FILE" "$USER@$HOST:/opt/tracking-bot/.env"
    if [ -n "${BOT_DEPLOY_KEY_FILE:-}" ]; then
      # Tracking-server SSH key, mounted read-only into the container via DEPLOY_SSH_KEY_PATH
      scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$BOT_DEPLOY_KEY_FILE" "$USER@$HOST:/opt/tracking-bot/tracking-server.pem"
      "${SSH[@]}" 'chmod 600 /opt/tracking-bot/tracking-server.pem'
    fi
    "${SSH[@]}" 'cd /opt/tracking-bot && chmod 600 .env && touch tracking-server.pem && chmod 600 tracking-server.pem && docker compose up -d --build --remove-orphans && sleep 3 && docker compose ps'
    ;;
  logs)   "${SSH[@]}" 'cd /opt/tracking-bot && docker compose logs -f --tail=200 bot' ;;
  status) "${SSH[@]}" 'curl -s localhost:3020/status' ;;
  restart) "${SSH[@]}" 'cd /opt/tracking-bot && docker compose restart bot' ;;
  down)   "${SSH[@]}" 'cd /opt/tracking-bot && docker compose down' ;;
  ssh)    "${SSH[@]}" ;;
  *) echo "usage: $0 setup|up|logs|status|restart|down|ssh"; exit 1 ;;
esac
