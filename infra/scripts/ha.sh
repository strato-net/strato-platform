#!/usr/bin/env bash
# Deploys one HA environment from environments/<env>.env. Whatever one stack
# needs from another (the VPC, Aurora endpoints, security groups, load
# balancer and instance names) is read from the deployed stacks, never copied
# by hand, so the same commands build an environment from nothing and update
# it. Jenkinsfile.testnet runs it; by hand it runs from any directory:
#
#   scripts/ha.sh <env> deploy <target>...        cdk deploy each target, in order
#   scripts/ha.sh <env> cdk <target> <args>...    any cdk command (diff, synth)
#   scripts/ha.sh <env> context <target>          the context a target is given
#   scripts/ha.sh <env> cells create              create missing cells, one at a time
#   scripts/ha.sh <env> cells upgrade             upgrade every cell in place, standbys first
#   scripts/ha.sh <env> cells wait-ready [<id>]   wait until cells follow the chain
#   scripts/ha.sh <env> cells lease               who holds the writer lease
#   scripts/ha.sh <env> install                   npm ci in every app
#   scripts/ha.sh <env> build-ui                  build app/ui and smd-ui for the front door
#   scripts/ha.sh <env> publish-scripts           node scripts and the cell upgrade script to NODE_SCRIPTS_S3
#   scripts/ha.sh <env> smoke                     check the deployment through its front door
#   scripts/ha.sh <env> record <strato> <infra>   record the deployed image set and commits
#   scripts/ha.sh <env> state                     the commits last deployed
#
# Targets, in deploy order: data-plane, obs-core, api-tier, app-tier,
# front-door, obs-alarms (cells: the cells command). Images come
# from STRATO_IMAGE, NGINX_IMAGE, POSTGREST_IMAGE, APEX_IMAGE, APP_NGINX_IMAGE
# and APP_BACKEND_IMAGE when set (the pipeline sets them), else from the set
# last deployed. strato-platform is read from STRATO_PLATFORM_DIR, default
# ../strato-platform beside this repo.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
envfile="$ROOT/environments/${1:?usage: scripts/ha.sh <env> <command> ...}.env"
shift
[[ -f $envfile ]] || { echo "ha.sh: no $envfile" >&2; exit 2; }
# shellcheck source=/dev/null
source "$envfile"
cmd=${1:?usage: scripts/ha.sh <env> <command> ...}
shift
export AWS_REGION AWS_DEFAULT_REGION=$AWS_REGION AWS_PAGER=""
export STRATO_PLATFORM_DIR=${STRATO_PLATFORM_DIR:-$(cd "$ROOT/.." && pwd)/strato-platform}
P=ha-$ENV_NAME
STATE=/$P/deploy
IMAGE_KEYS="STRATO_IMAGE NGINX_IMAGE POSTGREST_IMAGE APEX_IMAGE APP_NGINX_IMAGE APP_BACKEND_IMAGE"

die() { echo "ha.sh: $*" >&2; exit 1; }
log() { echo "[ha $(date -u +%H:%M:%S)] $*" >&2; }

# --- What is deployed ---
stack_status() { aws cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || true; }
exists() {
  local s; s=$(stack_status "$1")
  [[ -n $s && $s != None && $s != ROLLBACK_COMPLETE && $s != DELETE_COMPLETE ]]
}
out() {
  local v
  v=$(aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null) || v=""
  [[ $v == None ]] && v=""
  printf '%s' "$v"
}
need() {
  local v; v=$(out "$1" "$2")
  [[ -n $v ]] || die "$1 has no output $2: deploy it first"
  printf '%s' "$v"
}
vpc_id() {
  local v
  v=$(aws cloudformation describe-stack-resources --stack-name "$P-data-postgres" \
    --query "StackResources[?ResourceType=='AWS::EC2::VPC'].PhysicalResourceId | [0]" --output text 2>/dev/null) || v=""
  [[ -n $v && $v != None ]] || die "$P-data-postgres has no VPC: deploy data-plane first"
  printf '%s' "$v"
}
alb_full_name() {
  local arn
  arn=$(aws elbv2 describe-load-balancers --names "$1" --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null) || return 0
  [[ $arn == arn:* ]] && printf '%s' "${arn#*:loadbalancer/}"
  return 0
}
secret_exists() { aws secretsmanager describe-secret --secret-id "$1" >/dev/null 2>&1; }
ssm_get() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text 2>/dev/null || true; }
# --value=: a value starting with "-" (a recorded cell context) would otherwise read as an option.
ssm_put() { aws ssm put-parameter --name "$1" --type String --tier Intelligent-Tiering --overwrite --value="$2" >/dev/null; }

cell_ids() { local c; for c in $CELLS; do echo "${c%%:*}"; done; }
cell_zone() { local c; for c in $CELLS; do [[ ${c%%:*} == "$1" ]] && echo "${c#*:}"; done; return 0; }
host_stack() { echo "$P-cell-$1-host"; }
FIRST_CELL=${CELLS%% *}
FIRST_CELL=${FIRST_CELL%%:*}
existing_cells() { local id; for id in $(cell_ids); do exists "$(host_stack "$id")" && echo "$id"; done; return 0; }

# The image set: from the environment when the pipeline built one, else the one last deployed.
load_images() {
  local saved="" k v
  for k in $IMAGE_KEYS; do
    [[ -n ${!k:-} ]] && continue
    [[ -n $saved ]] || saved=$(ssm_get "$STATE/images")
    v=$(sed -n "s/^$k=//p" <<<"$saved")
    [[ -n $v ]] || die "$k is not set and no image set has been deployed to $ENV_NAME yet"
    printf -v "$k" '%s' "$v"
  done
}

# --- Node: the apps and the UIs need 22; without it on the host, a container runs it ---
node_run() {
  local dir=$1; shift
  if command -v node >/dev/null && (( $(node -p 'process.versions.node.split(".")[0]') >= 22 )); then
    (cd "$dir" && "$@")
    return
  fi
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_REGION -e AWS_DEFAULT_REGION -e STRATO_PLATFORM_DIR \
    -v "$ROOT:$ROOT" -v "$STRATO_PLATFORM_DIR:$STRATO_PLATFORM_DIR" -w "$dir" node:22 "$@"
}

# --- Context per target (into the array ctx) ---
otel_ecs() {
  exists "$P-obs-core" || return 0
  ctx+=(-c otelConfigParameterName="$(need "$P-obs-core" EcsCollectorParameter)" -c otelSidecarPolicyArn="$(need "$P-obs-core" SidecarPolicyArn)")
}

ctx_data_plane() {
  # The bus (MSK) stays off until the API tier submits through it.
  ctx=(-c envName="$ENV_NAME" -c engineVersion="$PG_ENGINE_VERSION" -c writerInstanceClass="$PG_INSTANCE_CLASS"
    -c readerInstanceClass="$PG_INSTANCE_CLASS" -c readerCount="$PG_READERS" -c bus=false)
}

ctx_obs() {
  ctx=(-c envName="$ENV_NAME" -c managedPrometheus=false -c managedGrafana=false -c auroraClusterIdentifier="$P-postgres")
  local ids=() albs=() id n a
  for id in $(existing_cells); do ids+=("$(need "$(host_stack "$id")" InstanceId)"); done
  for n in "$P-api" "$P-app"; do a=$(alb_full_name "$n"); [[ -n $a ]] && albs+=("$a"); done
  ((${#ids[@]})) && ctx+=(-c cellInstanceIds="$(IFS=,; echo "${ids[*]}")")
  ((${#albs[@]})) && ctx+=(-c albFullNames="$(IFS=,; echo "${albs[*]}")")
  return 0
}

# A cell's context is fixed when the cell is created and replayed afterwards:
# it ends up in the instance's user data, which cloud-init reads only at first
# boot, and a changed user data stops and starts the instance. Cells are
# upgraded in place instead (cells upgrade), and the API tier opens their
# ingress (cellSecurityGroupIds) so a cell never needs its stack redeployed.
ctx_cell_new() {
  local id=$1 first_of_cluster=$2 pg="$P-data-postgres"
  load_images
  ctx=(-c envName="$ENV_NAME" -c cellId="$id" -c role=core -c network="$NETWORK"
    -c vpcId="$(vpc_id)" -c subnetType=public -c availabilityZone="$(cell_zone "$id")"
    -c instanceType="$CELL_INSTANCE_TYPE" -c dataVolumeGiB="$CELL_DATA_GIB" -c stratoImage="$STRATO_IMAGE"
    -c postgresWriterHost="$(need "$pg" WriterEndpoint)" -c postgresReaderHost="$(need "$pg" ReaderEndpoint)"
    -c postgresSecurityGroupId="$(need "$pg" ClusterSecurityGroupId)"
    -c peerStore=sqlite -c validatorBehavior=false -c autoPromote=true
    -c oauthSecretName="$OAUTH_SECRET" -c extraSetupFlags="--vaultUrl=$VAULT_URL"
    -c snapshotBucket="$SNAPSHOT_BUCKET" -c snapshotSource="$SNAPSHOT_SOURCE"
    -c extraBinariesS3="$NODE_SCRIPTS_S3" -c exposePrometheus=true)
  # Only the first cell of an empty cluster restores eth and cirrus into it.
  [[ $first_of_cluster == true ]] && ctx+=(-c snapshotSkipDatabases=false)
  if [[ $id == "$FIRST_CELL" ]]; then
    ctx+=(-c writer=true -c ethconfParameterName="/$P/api/ethconf-base64" -c grafana=true
      -c grafanaPublicUrl="https://$NODE_HOSTNAME/grafana/" -c grafanaAdminGroups="$GRAFANA_ADMIN_GROUPS" -c grafanaViewerGroups="$GRAFANA_VIEWER_GROUPS")
  else
    ctx+=(-c writer=false)
  fi
  exists "$P-obs-core" && ctx+=(-c otelConfigParameterName="/$P/observability/otel-collector-cell" -c cloudWatchAgentParameterName="/$P/observability/cloudwatch-agent")
  return 0
}
ctx_cell() {
  local saved line
  saved=$(ssm_get "$STATE/cell-$1-context")
  [[ -n $saved ]] || die "cell $1 has no recorded context ($STATE/cell-$1-context); cells create records it"
  ctx=()
  while IFS= read -r line; do ctx+=("$line"); done <<<"$saved"
}

ctx_api() {
  load_images
  local pg="$P-data-postgres" cell id urls=() sgs=()
  cell=$(host_stack "$FIRST_CELL")
  # Every cell's ingress: a submit is posted to all of them.
  for id in $(existing_cells); do
    urls+=("http://$(need "$(host_stack "$id")" PrivateDnsName):8600")
    sgs+=("$(need "$(host_stack "$id")" SecurityGroupId)")
  done
  ((${#urls[@]})) || die "no cells: create them first (cells create)"
  ctx=(-c envName="$ENV_NAME" -c vpcId="$(vpc_id)"
    -c stratoImage="$STRATO_IMAGE" -c nginxImage="$NGINX_IMAGE" -c postgrestImage="$POSTGREST_IMAGE" -c apexImage="$APEX_IMAGE"
    -c postgresWriterHost="$(need "$pg" WriterEndpoint)" -c postgresReaderHost="$(need "$pg" ReaderEndpoint)"
    -c postgresSecurityGroupId="$(need "$pg" ClusterSecurityGroupId)" -c coreSecurityGroupId="$(need "$cell" SecurityGroupId)"
    -c ingressUrls="$(IFS=,; echo "${urls[*]}")" -c cellSecurityGroupIds="$(IFS=,; echo "${sgs[*]}")"
    -c ethconfParameterName="/$P/api/ethconf-base64"
    -c createSessionSecret=true -c oauthJsonSecretName="$OAUTH_SECRET" -c csrfStateless=true
    -c desiredCount="$API_DESIRED_COUNT" -c albCertificateArn="$CERTIFICATE_ARN" -c chainId="$CHAIN_ID" -c networkName="$NETWORK"
    -c prometheusHost="$(need "$cell" PrivateDnsName):9090" -c grafanaInstanceId="$(need "$cell" InstanceId)")
  otel_ecs
}

ctx_app() {
  load_images
  local pg="$P-data-postgres" session
  # The API tier mints the session cookie and this tier decrypts it: its
  # secret, by complete ARN (a name-only reference reads the random suffix
  # as part of the name).
  session=$(aws secretsmanager describe-secret --secret-id "$P/api/session-secret" --query ARN --output text 2>/dev/null) \
    || die "$P/api/session-secret does not exist: deploy api-tier first"
  ctx=(-c envName="$ENV_NAME" -c vpcId="$(vpc_id)" -c nginxImage="$APP_NGINX_IMAGE" -c backendImage="$APP_BACKEND_IMAGE"
    -c nodeUrl="https://$NODE_HOSTNAME" -c publicScheme=https
    -c postgresHost="$(need "$pg" ReaderEndpoint)" -c postgresPasswordSecretName="$P/postgres" -c postgresPasswordJsonKey=password
    -c postgresSecurityGroupId="$(need "$pg" ClusterSecurityGroupId)" -c chainId="$CHAIN_ID" -c networkName="$NETWORK"
    -c oauthSecretName="$OAUTH_SECRET" -c csrfStateless=true -c createSessionSecret=false -c sessionSecretName="$session"
    -c ethconfParameterName="/$P/api/ethconf-base64" -c httpPort=80 -c ui=false -c deployUi=false
    -c albCertificateArn="$CERTIFICATE_ARN" -c desiredCount="$APP_DESIRED_COUNT")
  if [[ -n ${BACKEND_SECRET:-} && -n ${BACKEND_SECRET_KEYS:-} ]] && secret_exists "$BACKEND_SECRET"; then
    ctx+=(-c backendSecretName="$BACKEND_SECRET" -c backendSecretKeys="$(echo $BACKEND_SECRET_KEYS | tr ' ' ,)")
  fi
  otel_ecs
}

ctx_front_door() {
  ctx_api
  ctx+=(-c frontDoorDomainName="$NODE_HOSTNAME" -c frontDoorCertificateArn="$CERTIFICATE_ARN"
    -c apiOriginDomainName="$(need "$P-api-tier" AlbDnsName)" -c appOriginDomainName="$(need "$P-app-tier" AlbDnsName)"
    -c deployAppUi=true -c deploySmdUi=true)
}

# target -> app directory, stacks to act on, context; skip names why a
# target this environment leaves out is not deployed.
resolve() {
  skip=""
  case $1 in
    obs-*) [[ $OBSERVABILITY == true ]] || { skip="OBSERVABILITY is off"; return; } ;;
  esac
  case $1 in
    data-plane) dir=data-plane; stacks=("$P-data-postgres"); ctx_data_plane ;;
    obs-core) dir=observability; stacks=("$P-obs-core"); ctx_obs ;;
    obs-alarms) dir=observability; stacks=("$P-obs-alarms"); ctx_obs ;;
    cell-*) dir=core-cell; stacks=("$P-$1-network" "$P-$1-host"); ctx_cell "${1#cell-}" ;;
    api-tier) dir=api-tier; stacks=("$P-api-network" "$P-api-tier"); ctx_api ;;
    app-tier) dir=app-tier; stacks=("$P-app-network" "$P-app-tier"); ctx_app ;;
    # --exclusively: the tier is deployed by its own target.
    front-door) dir=api-tier; stacks=("$P-api-frontdoor" --exclusively); ctx_front_door ;;
    *) die "unknown target $1" ;;
  esac
}

cdk_in() {
  local dir=$1; shift
  [[ -d $ROOT/$dir/node_modules ]] || node_run "$ROOT/$dir" npm ci --no-audit --no-fund --loglevel=error
  node_run "$ROOT/$dir" npx cdk "$@"
}

deploy() {
  local target dir stacks ctx skip
  for target in "$@"; do
    resolve "$target"
    [[ -z $skip ]] || { log "skip $target: $skip"; continue; }
    log "deploy $target: ${stacks[*]}"
    cdk_in "$dir" deploy "${stacks[@]}" --require-approval never --progress events "${ctx[@]}"
  done
}

# --- Cells: commands on the hosts through SSM ---
# ssm_run <instance> <timeout seconds> <script>: prints the output, returns the script's status.
# Callers use it in conditions, where set -e is off: every failure returns explicitly.
ssm_run() {
  local inst=$1 timeout=$2 script=$3 id status deadline
  id=$(aws ssm send-command --instance-ids "$inst" --document-name AWS-RunShellScript --timeout-seconds 600 \
    --parameters "$(python3 -c 'import json,sys; print(json.dumps({"commands": [sys.argv[1]], "executionTimeout": [sys.argv[2]]}))' "$script" "$timeout")" \
    --query Command.CommandId --output text) || return 1
  [[ -n $id ]] || return 1
  # Delivery waits up to 600 s, execution up to the timeout.
  deadline=$(( $(date +%s) + timeout + 660 ))
  while sleep 10; do
    status=$(aws ssm get-command-invocation --command-id "$id" --instance-id "$inst" --query Status --output text 2>/dev/null || echo Pending)
    case $status in Pending | InProgress | Delayed) ;; *) break ;; esac
    (( $(date +%s) < deadline )) || { status=TimedOut; break; }
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$inst" --query '[StandardOutputContent,StandardErrorContent]' --output text || true
  [[ $status == Success ]]
}
instance_of() { need "$(host_stack "$1")" InstanceId; }

# The cell the lease names ("writer lease: held by <cell> ..."), empty when unheld or unknown.
lease_holder() {
  local id holder
  for id in $(existing_cells); do
    holder=$(ssm_run "$(instance_of "$id")" 60 "cd /var/lib/strato/node && sudo -u strato -H env PATH=/usr/local/bin:/usr/bin:/bin strato-promote --status" 2>/dev/null \
      | sed -n 's/.*held by \([^ ]*\) .*/\1/p' | head -1) || true
    [[ -n $holder ]] && { echo "$holder"; return 0; }
  done
  return 0
}

# Fetches the current upgrade script from the node scripts prefix and runs it
# with the given arguments. SSM runs commands with /bin/sh (dash on Ubuntu),
# so the script hands itself to bash.
cell_script() {
  cat <<EOF
exec bash -s <<'CELL_SCRIPT'
set -euo pipefail
source /etc/strato/cell.env
export AWS_DEFAULT_REGION=\$AWS_REGION AWS_PAGER=""
aws s3 cp "\${EXTRA_BINARIES_S3}strato-cell-upgrade" /usr/local/bin/strato-cell-upgrade --only-show-errors
chmod 0755 /usr/local/bin/strato-cell-upgrade
/usr/local/bin/strato-cell-upgrade $*
CELL_SCRIPT
EOF
}

cells_wait_ready() {
  local deadline=$(( $(date +%s) + ${READY_TIMEOUT_MINUTES:-360} * 60 )) id ids
  ids=${1:-$(existing_cells)}
  for id in $ids; do
    log "cell $id: waiting until it follows the chain (bootstrap and snapshot restore run first)"
    # The last line the check printed; SSM's own "failed to run commands" line says nothing.
    until ssm_run "$(instance_of "$id")" 120 "$(cell_script --check)" 2>/dev/null | grep -v 'failed to run commands' | grep '[^[:space:]]' | tail -1; do
      (( $(date +%s) < deadline )) || die "cell $id is not following the chain after ${READY_TIMEOUT_MINUTES:-360} minutes; see /var/log/strato-cell-bootstrap.log on it"
      sleep 60
    done
  done
  # The API tier reads the node config the writer cell publishes.
  until aws ssm get-parameter --name "/$P/api/ethconf-base64" >/dev/null 2>&1; do
    (( $(date +%s) < deadline )) || die "/$P/api/ethconf-base64 was never published by cell $FIRST_CELL"
    sleep 30
  done
}

# Creates the missing cells, one at a time: a cell joins a cluster the cells
# before it have filled, so they must follow the chain first (also after a
# run that stopped while one was still bootstrapping). Returns once every
# cell follows the chain.
cells_create() {
  local id first_of_cluster=true ctx dir stacks
  [[ -n $(existing_cells) ]] && first_of_cluster=false
  for id in $(cell_ids); do
    exists "$(host_stack "$id")" && continue
    [[ -z $(existing_cells) ]] || cells_wait_ready
    secret_exists "$OAUTH_SECRET" || die "$OAUTH_SECRET does not exist: create it first (environments/$ENV_NAME.env)"
    ctx_cell_new "$id" "$first_of_cluster"
    ssm_put "$STATE/cell-$id-context" "$(printf '%s\n' "${ctx[@]}")"
    log "cell $id: creating $(host_stack "$id")"
    cdk_in core-cell deploy "$P-cell-$id-network" "$P-cell-$id-host" --require-approval never --progress events "${ctx[@]}"
    first_of_cluster=false
  done
  cells_wait_ready
}

# Standbys first, then the lease holder: while it restarts a standby takes the lease.
cells_upgrade() {
  load_images
  local holder id ids order=()
  ids=$(existing_cells)
  [[ -n $ids ]] || die "no cells to upgrade"
  holder=$(lease_holder)
  log "writer lease held by: ${holder:-nobody}"
  for id in $ids; do [[ $id != "$holder" ]] && order+=("$id"); done
  for id in $ids; do [[ $id == "$holder" ]] && order+=("$id"); done
  for id in "${order[@]}"; do
    log "cell $id: upgrading to $STRATO_IMAGE"
    ssm_run "$(instance_of "$id")" "$(( ${READY_TIMEOUT_MINUTES:-360} * 60 ))" "$(cell_script "$STRATO_IMAGE")" \
      || die "cell $id did not come back on $STRATO_IMAGE; the cells after it were left alone"
  done
}

# --- Front door checks: through CloudFront by name, whatever the hostname's DNS says ---
smoke() {
  local dist url=https://$NODE_HOSTNAME
  dist=$(need "$P-api-frontdoor" DistributionDomainName)
  c() { curl -fsS -m 30 -A ha-infra-smoke/1.0 --connect-to "$NODE_HOSTNAME:443:$dist:443" "$@"; }
  c "$url/strato-api/eth/v1.2/metadata" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("isSynced") is True, f"not synced: {d}"; print("metadata: synced,", d.get("networkName"))'
  c -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$url/rpc" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("rpc: block", int(d["result"], 16))'
  c -o /dev/null "$url/" && echo "app ui: ok"
  c -o /dev/null "$url/smd/" && echo "smd: ok"
  c -o /dev/null "$url/health" && echo "health: ok"
  echo "front door $dist; $NODE_HOSTNAME resolves to: $(dig +short "$NODE_HOSTNAME" | head -1)"
}

case $cmd in
  deploy) deploy "$@" ;;
  cdk)
    target=${1:?target}; shift; resolve "$target"
    if [[ -n $skip ]]; then log "skip $target: $skip"; else cdk_in "$dir" "$@" "${stacks[@]}" "${ctx[@]}"; fi ;;
  context)
    resolve "${1:?target}"
    if [[ -n $skip ]]; then log "skip ${1}: $skip"; else printf '%s\n' "${ctx[@]}" | paste -d' ' - -; fi ;;
  cells)
    case ${1:?cells create|upgrade|wait-ready|lease} in
      create) cells_create ;;
      upgrade) cells_upgrade ;;
      wait-ready) cells_wait_ready "${2:-}" ;;
      lease) echo "${P}: writer lease held by $(lease_holder)" ;;
      *) die "unknown cells command $1" ;;
    esac ;;
  install) for d in data-plane core-cell api-tier app-tier observability; do node_run "$ROOT/$d" npm ci --no-audit --no-fund --loglevel=error; done ;;
  build-ui) for d in app/ui smd-ui; do log "build $d"; node_run "$STRATO_PLATFORM_DIR/$d" bash -c 'npm ci --no-audit --no-fund --loglevel=error && npm run build'; done ;;
  publish-scripts)
    # What cell-bootstrap.sh installs from the NodeScripts asset, plus this repo's upgrade script.
    staging=$(mktemp -d)
    trap 'rm -rf "$staging"' EXIT
    find "$STRATO_PLATFORM_DIR/bin" -maxdepth 1 -type f -name 'strato-*' ! -name '*.md' ! -name strato-pg-migrate ! -name strato-patch-app -exec cp {} "$staging/" \;
    cp "$ROOT/core-cell/bootstrap/strato-cell-upgrade" "$staging/"
    aws s3 sync --delete --only-show-errors "$staging/" "$NODE_SCRIPTS_S3"
    log "published $(ls "$staging" | wc -l | tr -d ' ') scripts to $NODE_SCRIPTS_S3" ;;
  smoke) smoke ;;
  record)
    load_images
    ssm_put "$STATE/images" "$(for k in $IMAGE_KEYS; do echo "$k=${!k}"; done)"
    ssm_put "$STATE/commits" "strato-platform=${1:?strato-platform commit} ha-infra=${2:?ha-infra commit}" ;;
  state) ssm_get "$STATE/commits" ;;
  *) die "unknown command $cmd" ;;
esac
