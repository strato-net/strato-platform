#!/usr/bin/env bash
# First-boot bootstrap of a STRATO core cell (run by the instance's user data
# on Ubuntu 24.04, as root). Idempotent: every step checks its own state, so a
# rerun after a partial failure continues where it stopped, and a reboot does
# nothing but let systemd start the node.
#
# Reads /etc/strato/cell.env (written by the CDK stack). The Aurora password
# is fetched with the instance role at the moment strato-setup needs it and
# handed to it as an argument; it is not written to disk by this script.
set -euo pipefail
# The CLI pager swallows output when there is no terminal (SSM runs): off.
export AWS_PAGER=""
export DEBIAN_FRONTEND=noninteractive
source /etc/strato/cell.env
export AWS_DEFAULT_REGION="$AWS_REGION"

STRATO_ROOT=/var/lib/strato
NODE_DIR=$STRATO_ROOT/node
NODE_USER=strato
log() { echo "[cell-bootstrap $(date -u +%FT%TZ)] $*"; }

# --- 1. Packages: docker, the strato binaries' runtime libraries, tooling ---
log "packages"
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 \
  libgmp10 libblas3 liblapack3 libleveldb1d libpcre3 libpq5 librdkafka1 libsodium23 libsecp256k1-1 libstdc++6 \
  netbase netcat-openbsd postgresql-client jq curl zstd unzip logrotate
systemctl enable --now docker
# The CloudWatch agent (host metrics and convoke logs), only used when a config is published.
if [[ -n "$CW_AGENT_PARAMETER" ]] && ! dpkg -s amazon-cloudwatch-agent >/dev/null 2>&1; then
  curl -fsSL -o /tmp/amazon-cloudwatch-agent.deb "https://amazoncloudwatch-agent-${AWS_REGION}.s3.${AWS_REGION}.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb"
  dpkg -i /tmp/amazon-cloudwatch-agent.deb
fi

# --- 2. The node's user and its data volume ---
id -u $NODE_USER >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/$NODE_USER --shell /bin/bash --groups docker $NODE_USER
# The data device may show up under an NVMe name; find it by the requested name or by being the unformatted second disk.
# On a rerun the volume is already labelled (and usually mounted); find it by that first.
data_dev=$(blkid -L strato-data 2>/dev/null || readlink -f "$DATA_DEVICE" 2>/dev/null || true)
if [[ ! -b "$data_dev" ]]; then
  data_dev=$( (lsblk -dpno NAME,TYPE | awk '$2=="disk"{print $1}' | while read -r d; do [[ -z "$(lsblk -no MOUNTPOINT "$d" | tr -d '[:space:]')" ]] && echo "$d" && break; done) || true)
fi
[[ -b "$data_dev" ]] || { log "no data volume found"; exit 1; }
if ! blkid "$data_dev" >/dev/null 2>&1; then
  log "formatting $data_dev"
  mkfs.ext4 -q -L strato-data "$data_dev"
fi
install -d -m 0755 $STRATO_ROOT
grep -q "LABEL=strato-data" /etc/fstab || echo "LABEL=strato-data $STRATO_ROOT ext4 defaults,nofail 0 2" >> /etc/fstab
mountpoint -q $STRATO_ROOT || mount $STRATO_ROOT
chown $NODE_USER:$NODE_USER $STRATO_ROOT

# --- 3. Binaries from the strato image, node scripts from the repo ---
log "image $STRATO_IMAGE"
registry=${STRATO_IMAGE%%/*}
# Both root (this script) and the node's user (convoke's compose pulls) need the registry login.
# Writes the node user's ~/.secrets/strato_credentials.yaml (strato-login's
# output) from the OAUTH_SECRET_ID secret, for strato-setup's external-auth mode.
install_oauth_credentials() {
  [[ -n "${OAUTH_SECRET_ID:-}" ]] || { log "no OAUTH_SECRET_ID: strato-setup needs strato-login's credentials"; return 0; }
  local home; home=$(getent passwd $NODE_USER | cut -d: -f6)
  install -d -o $NODE_USER -g $NODE_USER -m 0700 "$home/.secrets"
  aws secretsmanager get-secret-value --secret-id "$OAUTH_SECRET_ID" --query SecretString --output text \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(f"{k}: \"{d[k]}\"" for k in ("discoveryUrl","clientId","clientSecret")))' \
    > "$home/.secrets/strato_credentials.yaml.tmp"
  chown $NODE_USER:$NODE_USER "$home/.secrets/strato_credentials.yaml.tmp"; chmod 0600 "$home/.secrets/strato_credentials.yaml.tmp"
  mv "$home/.secrets/strato_credentials.yaml.tmp" "$home/.secrets/strato_credentials.yaml"
  log "OAuth client credentials installed for $NODE_USER from $OAUTH_SECRET_ID"
}

registry_login() {
  aws ecr get-login-password | docker login --username AWS --password-stdin "$registry" >/dev/null 2>&1
  aws ecr get-login-password | sudo -u $NODE_USER -H docker login --username AWS --password-stdin "$registry" >/dev/null 2>&1
}
registry_login
docker pull -q "$STRATO_IMAGE"
cid=$(docker create "$STRATO_IMAGE")
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
rm -rf /tmp/strato-bin && docker cp "$cid:/usr/local/bin" /tmp/strato-bin
# Regular files only: the image's bin directory also holds a directory entry (queryStrato).
find /tmp/strato-bin -maxdepth 1 -type f -exec install -m 0755 {} /usr/local/bin/ \;
docker rm -f "$cid" >/dev/null; trap - EXIT
aws s3 cp "$NODE_SCRIPTS_S3" /tmp/node-scripts.zip
rm -rf /tmp/node-scripts && mkdir /tmp/node-scripts && unzip -o -q /tmp/node-scripts.zip -d /tmp/node-scripts
install -m 0755 /tmp/node-scripts/strato-* /usr/local/bin/
# The BIP39 word list strato-user-add derives wallet keys from (make installs it per user; here system-wide).
install -d -m 0755 /usr/local/share/strato && install -m 0644 /opt/strato/bootstrap/bip39-english.txt /usr/local/share/strato/bip39-english.txt
if [[ -n "${EXTRA_BINARIES_S3:-}" ]]; then
  rm -rf /tmp/extra-bin && mkdir /tmp/extra-bin
  aws s3 cp --recursive "$EXTRA_BINARIES_S3" /tmp/extra-bin --only-show-errors
  find /tmp/extra-bin -maxdepth 1 -type f -exec install -m 0755 {} /usr/local/bin/ \;
fi
strato-setup --help >/dev/null 2>&1 || strato-setup --version >/dev/null 2>&1 || log "warning: strato-setup did not run; check the image's binaries against this host's libraries"

# --- 3b. TLS: a Let's Encrypt certificate for the public hostname ---
# The node URL (and so the OAuth issuer and the app's own address) derives
# from the machine hostname, so the hostname becomes the public name too.
ssl=()
if [[ -n "${TLS_HOSTNAME:-}" ]]; then
  log "tls for $TLS_HOSTNAME"
  hostnamectl set-hostname "$TLS_HOSTNAME"
  grep -q " $TLS_HOSTNAME" /etc/hosts || echo "127.0.1.1 $TLS_HOSTNAME" >> /etc/hosts
  apt-get install -y -q certbot >/dev/null
  install -d -m 0755 /etc/strato/ssl
  cat > /etc/letsencrypt/renewal-hooks/deploy/strato.sh <<EOF
#!/bin/bash
# Copies the renewed certificate where the node reads it and reloads nginx.
set -e
install -m 0644 /etc/letsencrypt/live/$TLS_HOSTNAME/fullchain.pem /etc/strato/ssl/server.pem
install -m 0640 -g $NODE_USER /etc/letsencrypt/live/$TLS_HOSTNAME/privkey.pem /etc/strato/ssl/server.key
if [[ -d $NODE_DIR/secrets ]]; then
  install -d -o $NODE_USER -g $NODE_USER -m 0755 $NODE_DIR/secrets/ssl
  install -o $NODE_USER -g $NODE_USER -m 0644 /etc/strato/ssl/server.pem $NODE_DIR/secrets/ssl/server.pem
  install -o $NODE_USER -g $NODE_USER -m 0600 /etc/strato/ssl/server.key $NODE_DIR/secrets/ssl/server.key
fi
docker exec strato-nginx-1 nginx -s reload 2>/dev/null || docker restart strato-nginx-1 2>/dev/null || true
EOF
  chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/strato.sh
  if [[ ! -s /etc/letsencrypt/live/$TLS_HOSTNAME/fullchain.pem ]]; then
    email=(--register-unsafely-without-email); [[ -n "${LETSENCRYPT_EMAIL:-}" ]] && email=(--email "$LETSENCRYPT_EMAIL")
    certbot certonly --standalone --non-interactive --agree-tos "${email[@]}" -d "$TLS_HOSTNAME"
  fi
  bash /etc/letsencrypt/renewal-hooks/deploy/strato.sh
  node_host="$TLS_HOSTNAME"
  ssl=(--sslDir=/etc/strato/ssl)
fi

# --- 4. The node directory: setup once, from a snapshot when given ---
imds_token=$(curl -s -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 120' http://169.254.169.254/latest/api/token)
private_dns=$(curl -s -H "X-aws-ec2-metadata-token: $imds_token" http://169.254.169.254/latest/meta-data/local-hostname)
public_ip=$(curl -s -H "X-aws-ec2-metadata-token: $imds_token" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
node_host=${public_ip:-$private_dns}
if [[ ! -d $NODE_DIR ]]; then
  log "setup: network=$NETWORK cell=$CELL_ID role=$ROLE writer=$WRITER validator=$VALIDATOR_BEHAVIOR host=$node_host"
  vmq=(); [[ "$VM_QUERY" == "true" ]] && vmq=(--vmQuery)
  auth=()
  if [[ "$LOCAL_AUTH" == "true" ]]; then
    # The local OpenID provider's admin password: generated once, kept root-only
    # on the host, handed to strato-user-add through the environment.
    auth=(--localAuth)
    if [[ ! -s /etc/strato/local-auth-admin-password ]]; then
      (umask 077; openssl rand -base64 18 | tr -d '/+=' | cut -c1-20 > /etc/strato/local-auth-admin-password)
    fi
  else
    # External provider (Keycloak): strato-setup copies the node's OAuth client
    # from where strato-login writes it, and creates the node key in the shared
    # vault under that client. The secret is JSON {discoveryUrl, clientId,
    # clientSecret}; it goes from Secrets Manager to the node user's file only.
    install_oauth_credentials
  fi
  peerdb=(); [[ -n "${PEER_DATABASE:-}" ]] && peerdb=(--peerDatabase="$PEER_DATABASE")
  # A node whose app or SMD is served elsewhere. The flags go only when they
  # differ from strato-setup's defaults, so an image without them still sets up.
  apps=()
  [[ "${BUNDLED_APP:-true}" == "false" ]] && apps+=(--bundledApp=false --appUrl="${APP_URL:-}")
  [[ "${BUNDLED_SMD:-true}" == "false" ]] && apps+=(--bundledSmd=false --smdUrl="${SMD_URL:-}")
  [[ "${BUNDLED_POSTGREST:-true}" == "false" ]] && apps+=(--bundledPostgrest=false)
  # shellcheck disable=SC2206
  extra=($EXTRA_SETUP_FLAGS)
  pg_password=$(aws secretsmanager get-secret-value --secret-id "$PG_SECRET_ID" --query SecretString --output text | jq -r .password)
  # 4a. The node directory (ethconf, secrets, genesis, docker-compose.yml, commands.txt).
  sudo -u $NODE_USER -H env PATH="$PATH" \
    strato-setup "$NODE_DIR" --role="$ROLE" --network="$NETWORK" --nodeHost="$node_host" \
      --pghost="$PG_WRITER_HOST" --pgReaderHost="$PG_READER_HOST" --password="$pg_password" \
      --kafkaExternalHost="$private_dns" --cellId="$CELL_ID" "${peerdb[@]}" --peerStore="${PEER_STORE:-postgres}" \
      --writer="$WRITER" --validatorBehavior="$VALIDATOR_BEHAVIOR" --repoUrl="$REPO_URL" \
      "${vmq[@]}" "${apps[@]}" "${auth[@]}" "${ssl[@]}" "${extra[@]}"
  unset pg_password
  # 4b. A snapshot, when asked for (strato-up would skip it once the directory exists).
  if [[ -n "$SNAPSHOT_SOURCE" ]]; then
    [[ -n "$SNAPSHOT_BUCKET" ]] && export STRATO_SNAPSHOT_BUCKET="$SNAPSHOT_BUCKET"
    if [[ "$SNAPSHOT_SOURCE" == s3://* ]]; then snap=(--source "$SNAPSHOT_SOURCE"); else snap=(--snapshot="$SNAPSHOT_SOURCE"); fi
    sudo -u $NODE_USER -H env PATH="$PATH" STRATO_SNAPSHOT_BUCKET="${STRATO_SNAPSHOT_BUCKET:-}" \
      strato-snapshot restore "$NODE_DIR" "${snap[@]}" --network "$NETWORK" --force
  fi
fi
# 4c. The generated compose names the node's own images by bare name (as on a
# developer machine after `make docker`); local mode does not apply --repoUrl.
# Pull each from the registry and tag it with the name compose expects.
registry_login
for ref in $(grep -E '^\s*image:' "$NODE_DIR/docker-compose.yml" | awk '{print $2}' | tr -d '"' | grep -v '/'); do
  name=${ref%%:*}; tag=${ref#*:}
  docker image inspect "$ref" >/dev/null 2>&1 && continue
  if docker pull -q "${REPO_URL}${name}:${tag}" >/dev/null 2>&1; then docker tag "${REPO_URL}${name}:${tag}" "$ref"; log "tagged $ref from the registry"; fi
done

# --- 5. systemd owns convoke from now on ---
if [[ -s /etc/strato/local-auth-admin-password ]]; then
  (umask 077; printf 'LOCAL_AUTH_ADMIN_PASSWORD=%s\nSTRATO_BIP39_WORDLIST=/usr/local/share/strato/bip39-english.txt\n' "$(cat /etc/strato/local-auth-admin-password)" > /etc/strato/cell-service.env)
fi
cat > /etc/systemd/system/strato-cell.service <<EOF
[Unit]
Description=STRATO core cell ($CELL_ID): convoke and the node's containers
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=$NODE_USER
WorkingDirectory=$NODE_DIR
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=-/etc/strato/cell-service.env
ExecStart=/usr/local/bin/strato-up $NODE_DIR
ExecStop=/usr/local/bin/strato-down $NODE_DIR
TimeoutStartSec=1800
TimeoutStopSec=180

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now strato-cell.service

# --- 6. Observability, when the observability app has published configs ---
if [[ -n "$OTEL_CONFIG_PARAMETER" ]]; then
  log "otel collector"
  # Through a pipe: with a file on stdout the CLI on this image writes nothing.
  aws ssm get-parameter --name "$OTEL_CONFIG_PARAMETER" --query Parameter.Value --output text | cat > /etc/strato/otel-collector.yaml
  docker rm -f strato-otel-collector >/dev/null 2>&1 || true
  docker run -d --name strato-otel-collector --restart unless-stopped --network host \
    -v /etc/strato/otel-collector.yaml:/etc/otel/config.yaml:ro \
    public.ecr.aws/aws-observability/aws-otel-collector:v0.43.0 --config /etc/otel/config.yaml >/dev/null
  # The node's own processes export spans to the collector over localhost
  # (strato-tracing reads OTEL_EXPORTER_OTLP_ENDPOINT; convoke passes the
  # service environment file to every process).
  grep -q '^OTEL_EXPORTER_OTLP_ENDPOINT=' /etc/strato/cell-service.env 2>/dev/null \
    || (umask 077; printf 'OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318\n' >> /etc/strato/cell-service.env)
fi
if [[ -n "$CW_AGENT_PARAMETER" ]]; then
  log "cloudwatch agent"
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c "ssm:$CW_AGENT_PARAMETER" -s
fi

# --- 7. Grafana on the node's own Prometheus (proof-out; the observability app is the managed path) ---
if [[ "$GRAFANA" == "true" ]]; then
  log "grafana"
  G=/etc/strato/grafana
  install -d -m 0755 $G/provisioning/datasources $G/provisioning/dashboards $G/dashboards
  cat > $G/provisioning/datasources/prometheus.yaml <<'YAML'
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    # The node's Prometheus serves under a route prefix (prometheus-packager: --web.route-prefix=/prometheus).
    url: http://prometheus:9090/prometheus
    isDefault: true
YAML
  # CloudWatch through the instance role (CloudWatchReadOnlyAccess): the
  # tier map reads ECS Container Insights and the Aurora instances from it.
  # A second, identical CloudWatch data source serves the tier map's Logs
  # Insights query: queries sharing a data source share a request id, and
  # Grafana's frontend cancels the Logs StartQuery when the panel's metric
  # request goes out.
  cat > $G/provisioning/datasources/cloudwatch.yaml <<YAML
apiVersion: 1
datasources:
  - name: CloudWatch
    uid: cloudwatch
    type: cloudwatch
    access: proxy
    jsonData:
      authType: default
      defaultRegion: $AWS_REGION
  - name: CloudWatch Logs
    uid: cloudwatch-logs
    type: cloudwatch
    access: proxy
    jsonData:
      authType: default
      defaultRegion: $AWS_REGION
YAML
  # Business Charts draws the tier map (boxes per instance, columns per tier).
  # 7.x needs Grafana 12.3; 6.6 is the last line for the 11.2 image below.
  grafana_plugin_list="volkovlabs-echarts-panel 6.6.0"
  # With a collector on the host, X-Ray holds the traces: the service map
  # dashboard reads it through the instance role (AWSXrayReadOnlyAccess).
  if [[ -n "$OTEL_CONFIG_PARAMETER" ]]; then
    cat > $G/provisioning/datasources/xray.yaml <<YAML
apiVersion: 1
datasources:
  - name: X-Ray
    uid: xray
    type: grafana-x-ray-datasource
    access: proxy
    jsonData:
      authType: default
      defaultRegion: $AWS_REGION
YAML
    grafana_plugins=(-e "GF_INSTALL_PLUGINS=grafana-x-ray-datasource,$grafana_plugin_list")
    xray_uid=xray
  else
    rm -f $G/provisioning/datasources/xray.yaml
    grafana_plugins=(-e "GF_INSTALL_PLUGINS=$grafana_plugin_list")
    xray_uid=prometheus
  fi
  cat > $G/provisioning/dashboards/strato.yaml <<'YAML'
apiVersion: 1
providers:
  - name: strato
    folder: STRATO
    type: file
    options: { path: /var/lib/grafana/dashboards }
YAML
  aws s3 cp "$DASHBOARDS_S3" /tmp/dashboards.zip --only-show-errors
  rm -rf /tmp/dashboards && mkdir /tmp/dashboards && unzip -o -q /tmp/dashboards.zip -d /tmp/dashboards
  # The repo's dashboards are Grafana exports with datasource inputs; bind them all to the local Prometheus.
  # The env label is an external label of Managed Prometheus; the node's own
  # Prometheus has none, so drop that matcher from the local copies.
  # The tier map's CloudWatch log groups carry the environment in their
  # names; the node's Prometheus has no env label to fill $env from.
  for f in /tmp/dashboards/*.json; do sed -e 's/\${DS_PROMETHEUS}/prometheus/g' -e 's/\${DS_CLOUDWATCH}/cloudwatch/g' -e 's/\${DS_CLOUDWATCH_LOGS}/cloudwatch-logs/g' -e "s/\${DS_XRAY}/$xray_uid/g" \
    -e 's/{env=\\"$env\\",/{/g' -e 's/,env=\\"$env\\"//g' -e 's/{env=\\"$env\\"}/{}/g' -e "s|-\$env/|-$STRATO_ENV/|g" "$f" > "$G/dashboards/$(basename "$f")"; done
  # The tier map names CloudFront distributions from this (E123ABC=SMD,...).
  if [[ -n "${FRONTEND_LABELS:-}" ]]; then
    set -- $G/dashboards/*.json
    python3 - "$FRONTEND_LABELS" "$@" <<'PY'
import json, sys
# Names the tier map's CloudFront distributions (frontend_labels variable).
labels = sys.argv[1]
for path in sys.argv[2:]:
    d = json.load(open(path)); changed = False
    for v in d.get("templating", {}).get("list", []):
        if v.get("name") == "frontend_labels":
            v["query"] = labels; v["current"] = {"text": labels, "value": labels}; changed = True
    if changed:
        json.dump(d, open(path, "w")); print("frontend_labels set in", path)
PY
  fi
  if [[ ! -s /etc/strato/grafana-admin-password ]]; then (umask 077; openssl rand -base64 18 | tr -d '/+=' | cut -c1-20 > /etc/strato/grafana-admin-password); fi
  # Grafana runs as uid 472 inside its container and reads the file itself.
  chown 472:472 /etc/strato/grafana-admin-password; chmod 0400 /etc/strato/grafana-admin-password
  # The node's containers share the compose network; wait for it to exist.
  for i in $(seq 1 60); do docker network inspect strato_default >/dev/null 2>&1 && break; sleep 10; done
  docker rm -f strato-grafana >/dev/null 2>&1 || true
  docker run -d --name strato-grafana --restart unless-stopped --network strato_default -p 3001:3000 \
    -e GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/grafana-admin-password \
    -e GF_AUTH_ANONYMOUS_ENABLED=true -e GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer -e GF_AUTH_ANONYMOUS_ORG_NAME="Main Org." \
    -e GF_SERVER_ROOT_URL="http://${node_host:-localhost}:3001/" -e GF_SECURITY_COOKIE_SECURE=false "${grafana_plugins[@]}" \
    -v /etc/strato/grafana-admin-password:/run/secrets/grafana-admin-password:ro \
    -v $G/provisioning:/etc/grafana/provisioning:ro -v $G/dashboards:/var/lib/grafana/dashboards:ro \
    grafana/grafana-oss:11.2.0 >/dev/null
fi

# --- 7b. Container states to CloudWatch (for the tier map) ---
# The node's Prometheus scrapes its processes but not its containers (redis,
# the broker, nginx, postgrest, apex, the app). Once a minute each container
# on the host becomes a STRATO/Cell ContainerUp datapoint (1 running, 0 not),
# keyed by the cell's hostname so the map can put it in the cell's box. The
# cell role's CloudWatchAgentServerPolicy allows cloudwatch:PutMetricData.
cat > /usr/local/bin/strato-cell-containers <<'SCRIPT'
#!/bin/bash
set -uo pipefail
. /etc/strato/cell.env
export AWS_DEFAULT_REGION=${AWS_REGION:-us-east-1} AWS_PAGER=""
cell=${TLS_HOSTNAME:-$(hostname)}
data=()
while IFS='|' read -r name state; do
  [[ -z "$name" ]] && continue
  name=${name#strato-}; name=${name%-1}
  value=0; [[ "$state" == "running" ]] && value=1
  data+=("MetricName=ContainerUp,Dimensions=[{Name=Cell,Value=$cell},{Name=Container,Value=$name}],Value=$value,Unit=Count")
done < <(docker ps -a --format '{{.Names}}|{{.State}}')
(( ${#data[@]} )) && aws cloudwatch put-metric-data --namespace STRATO/Cell --metric-data "${data[@]}"
SCRIPT
chmod 0755 /usr/local/bin/strato-cell-containers
cat > /etc/systemd/system/strato-cell-containers.service <<'UNIT'
[Unit]
Description=Publish the cell's container states to CloudWatch
[Service]
Type=oneshot
ExecStart=/usr/local/bin/strato-cell-containers
UNIT
cat > /etc/systemd/system/strato-cell-containers.timer <<'UNIT'
[Unit]
Description=Publish the cell's container states to CloudWatch every minute
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now strato-cell-containers.timer

# --- 8. Log rotation for the node's process logs ---
cat > /etc/cron.daily/strato-logrotate <<EOF
#!/bin/sh
sudo -u $NODE_USER -H /usr/local/bin/strato-logrotate $NODE_DIR >/dev/null 2>&1 || true
EOF
chmod 0755 /etc/cron.daily/strato-logrotate
log "done; node under systemd unit strato-cell.service, logs in $NODE_DIR/logs"
