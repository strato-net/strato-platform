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
#   scripts/ha.sh <env> cells deploy              deploy every cell's stack, creating missing cells one at a time
#   scripts/ha.sh <env> cells upgrade [<id>]      upgrade every cell (or one) in place, standbys first
#   scripts/ha.sh <env> cells restart [<id>]      restart every cell (or one) on the version it runs, standbys first
#   scripts/ha.sh <env> cells replace <id>        a new instance for the cell, from the latest snapshot
#   scripts/ha.sh <env> cells instance <id>       the cell's current instance id
#   scripts/ha.sh <env> cells wait-ready [<id>]   wait until cells follow the chain
#   scripts/ha.sh <env> cells lease               who holds the writer lease
#   scripts/ha.sh <env> install                   npm ci in every app
#   scripts/ha.sh <env> build-ui                  build app/ui and smd-ui for the front door
#   scripts/ha.sh <env> publish-scripts           node scripts and the cell upgrade and health scripts to NODE_SCRIPTS_S3
#   scripts/ha.sh <env> smoke                     check the deployment through its front door
#   scripts/ha.sh <env> record <strato> <infra>   record the deployed image set and commits
#   scripts/ha.sh <env> state                     the commits last deployed
#
# Targets, in deploy order: data-plane, obs-core, core-nlb, the cells (the
# cells command), api-tier, app-tier, front-door, obs-alarms. Images come
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
# The strato image the cells run: cells upgrade records it, a new instance of a cell installs it.
CELL_IMAGE=/$P/core/strato-image
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

# The image set: from the environment when the pipeline resolved one, else the one last deployed.
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
  local groups=() albs=() id n a
  for id in $(existing_cells); do groups+=("$P-cell-$id"); done
  for n in "$P-api" "$P-app"; do a=$(alb_full_name "$n"); [[ -n $a ]] && albs+=("$a"); done
  ((${#groups[@]})) && ctx+=(-c cellGroupNames="$(IFS=,; echo "${groups[*]}")")
  ((${#albs[@]})) && ctx+=(-c albFullNames="$(IFS=,; echo "${albs[*]}")")
  return 0
}

# A cell's stack is deployed on every run, and nothing in it touches the
# running instance: the launch template is what the next instance boots (after
# cells replace, or when the watchdog or EC2 gives the current one up), so it
# has to carry the current bootstrap, while the running node is upgraded in
# place (cells upgrade). Every cell gets the same settings: at its first boot
# an instance asks the cluster whether to load the snapshot's databases and
# start as the writer (an empty cluster) or to join as a standby.
ctx_cell() {
  local id=$1 pg="$P-data-postgres" core="$P-core-nlb"
  load_images
  ctx=(-c envName="$ENV_NAME" -c cellId="$id" -c role=core -c network="$NETWORK"
    -c vpcId="$(vpc_id)" -c subnetType=public -c availabilityZone="$(cell_zone "$id")"
    -c instanceType="$CELL_INSTANCE_TYPE" -c dataVolumeGiB="$CELL_DATA_GIB"
    -c stratoImage="$STRATO_IMAGE" -c stratoImageParameter="$CELL_IMAGE"
    -c postgresWriterHost="$(need "$pg" WriterEndpoint)" -c postgresReaderHost="$(need "$pg" ReaderEndpoint)"
    -c postgresSecurityGroupId="$(need "$pg" ClusterSecurityGroupId)"
    -c peerStore=sqlite -c validatorBehavior=false -c autoPromote=true -c seedEmptyCluster=true
    -c oauthSecretName="$OAUTH_SECRET" -c extraSetupFlags="--vaultUrl=$VAULT_URL"
    -c snapshotBucket="$SNAPSHOT_BUCKET" -c snapshotSource="$SNAPSHOT_SOURCE"
    -c extraBinariesS3="$NODE_SCRIPTS_S3" -c exposePrometheus=true
    -c coreLoadBalancerSecurityGroupId="$(need "$core" SecurityGroupId)" -c ingressTargetGroupArn="$(need "$core" IngressTargetGroupArn)")
  # The first cell publishes the node config for the API tier, runs Grafana and is the one whose Prometheus apex reads.
  if [[ $id == "$FIRST_CELL" ]]; then
    ctx+=(-c ethconfParameterName="/$P/api/ethconf-base64" -c grafana=true
      -c grafanaPublicUrl="https://$NODE_HOSTNAME/grafana/" -c grafanaAdminGroups="$GRAFANA_ADMIN_GROUPS" -c grafanaViewerGroups="$GRAFANA_VIEWER_GROUPS"
      -c prometheusTargetGroupArn="$(need "$core" PrometheusTargetGroupArn)")
    # The Grafana target group gets its load balancer with the API tier, which
    # is deployed after the cells: the cell joins it from the next run on.
    exists "$P-api-tier" && ctx+=(-c grafanaTargetGroupArn="$(need "$core" GrafanaTargetGroupArn)")
  fi
  exists "$P-obs-core" && ctx+=(-c otelConfigParameterName="/$P/observability/otel-collector-cell" -c cloudWatchAgentParameterName="/$P/observability/cloudwatch-agent")
  return 0
}

# A cell from before the cells became Auto Scaling groups has an instance of
# its own, which a deploy of the core tier would leave running without a stack
# and without its place behind the load balancer.
refuse_plain_instances() {
  local id
  for id in $(existing_cells); do
    [[ -z $(out "$(host_stack "$id")" InstanceId) ]] || die "cell $id is a plain instance: tear the environment down and build it again"
  done
}

# The core tier's load balancer and target groups: deployed before the cells, which register in them.
ctx_core_nlb() {
  refuse_plain_instances
  ctx=(-c envName="$ENV_NAME" -c coreNlb=true -c vpcId="$(vpc_id)")
}

ctx_api() {
  load_images
  local pg="$P-data-postgres" cell core
  cell=$(host_stack "$FIRST_CELL")
  # The cells are reached through their load balancer: a submit goes to one healthy cell.
  core=$(need "$P-core-nlb" DnsName)
  ctx=(-c envName="$ENV_NAME" -c vpcId="$(vpc_id)"
    -c stratoImage="$STRATO_IMAGE" -c nginxImage="$NGINX_IMAGE" -c postgrestImage="$POSTGREST_IMAGE" -c apexImage="$APEX_IMAGE"
    -c postgresWriterHost="$(need "$pg" WriterEndpoint)" -c postgresReaderHost="$(need "$pg" ReaderEndpoint)"
    -c postgresSecurityGroupId="$(need "$pg" ClusterSecurityGroupId)" -c coreSecurityGroupId="$(need "$cell" SecurityGroupId)"
    -c ingressUrls="http://$core:8600" -c coreLoadBalancerSecurityGroupId="$(need "$P-core-nlb" SecurityGroupId)"
    -c ethconfParameterName="/$P/api/ethconf-base64"
    -c createSessionSecret=true -c oauthJsonSecretName="$OAUTH_SECRET" -c csrfStateless=true
    -c desiredCount="$API_DESIRED_COUNT" -c albCertificateArn="$CERTIFICATE_ARN" -c chainId="$CHAIN_ID" -c networkName="$NETWORK"
    -c prometheusHost="$core:9090" -c grafanaTargetGroupArn="$(need "$P-core-nlb" GrafanaTargetGroupArn)")
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
    core-nlb) dir=core-cell; stacks=("$P-core-nlb"); ctx_core_nlb ;;
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
# The cell's instance: the one its Auto Scaling group has in service, nothing while it is being replaced.
instance_of() {
  aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$P-cell-$1" \
    --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`] | [0].InstanceId' --output text 2>/dev/null | grep -v '^None$' || true
}

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

# Deploys every cell's stack, one cell at a time. A missing cell is created
# only once the cells before it follow the chain (also after a run that
# stopped while one was still bootstrapping), and is waited for before the
# next: the first boot of a cell on an empty cluster loads the snapshot's
# databases into it, and a second cell starting beside it would do the same.
# An existing cell only has its stack brought up to date, without waiting, so
# a broken cell does not block the cells upgrade that may fix it.
cells_deploy() {
  local id new ctx dir stacks
  refuse_plain_instances
  for id in $(cell_ids); do
    new=false
    if ! exists "$(host_stack "$id")"; then
      new=true
      [[ -z $(existing_cells) ]] || cells_wait_ready
      secret_exists "$OAUTH_SECRET" || die "$OAUTH_SECRET does not exist: create it first (environments/$ENV_NAME.env)"
    fi
    ctx_cell "$id"
    log "cell $id: deploying $(host_stack "$id")"
    cdk_in core-cell deploy "$P-cell-$id-network" "$P-cell-$id-host" --require-approval never --progress events "${ctx[@]}"
    if [[ $new == true ]]; then cells_wait_ready "$id"; fi
  done
}

# The cells to act on, one per line: the given one, or every cell with the
# standbys first and then the lease holder, whose lease a standby takes while
# it restarts.
cells_in_order() {
  local holder id ids
  ids=$(existing_cells)
  [[ -n $ids ]] || die "no cells"
  if [[ -n ${1:-} ]]; then
    grep -qx "$1" <<<"$ids" || die "no cell $1 (cells: $(echo $ids))"
    echo "$1"
    return 0
  fi
  holder=$(lease_holder)
  log "writer lease held by: ${holder:-nobody}"
  for id in $ids; do [[ $id != "$holder" ]] && echo "$id"; done
  for id in $ids; do [[ $id == "$holder" ]] && echo "$id"; done
  return 0
}

cells_upgrade() {
  load_images
  local id order
  order=$(cells_in_order "${1:-}")
  for id in $order; do
    log "cell $id: upgrading to $STRATO_IMAGE"
    ssm_run "$(instance_of "$id")" "$(( ${READY_TIMEOUT_MINUTES:-360} * 60 ))" "$(cell_script "$STRATO_IMAGE")" \
      || die "cell $id did not come back on $STRATO_IMAGE; the cells after it were left alone"
    # Proven on a cell: what a replaced instance installs from now on.
    ssm_put "$CELL_IMAGE" "$STRATO_IMAGE"
  done
}

# The same version, restarted in place: drained, the node restarted, back on
# the chain before the next cell is touched.
cells_restart() {
  local id order
  order=$(cells_in_order "${1:-}")
  for id in $order; do
    log "cell $id: restarting"
    ssm_run "$(instance_of "$id")" "$(( ${READY_TIMEOUT_MINUTES:-360} * 60 ))" "$(cell_script --restart)" \
      || die "cell $id did not follow the chain again after its restart; the cells after it were left alone"
  done
}

# A new instance for the cell: its Auto Scaling group replaces the one marked
# unhealthy, and the new one restores the latest snapshot. Refused unless
# another cell is healthy behind the load balancer, since this one is away
# for as long as a restore and a catch-up take.
cells_replace() {
  local id=${1:?cells replace <id>} old new healthy deadline
  exists "$(host_stack "$id")" || die "no cell $id"
  old=$(instance_of "$id")
  healthy=$(aws elbv2 describe-target-health --target-group-arn "$(need "$P-core-nlb" IngressTargetGroupArn)" \
    --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy' && Target.Id!='${old:-none}'])" --output text)
  (( healthy > 0 )) || die "no other cell is healthy behind the load balancer: replacing cell $id would leave none"
  if [[ -n $old ]]; then
    log "cell $id: replacing instance $old"
    aws autoscaling set-instance-health --instance-id "$old" --health-status Unhealthy --no-should-respect-grace-period
  fi
  deadline=$(( $(date +%s) + 1800 ))
  until new=$(instance_of "$id"); [[ -n $new && $new != "$old" ]]; do
    (( $(date +%s) < deadline )) || die "cell $id has no new instance after 30 minutes; see the activity of its Auto Scaling group $P-cell-$id"
    sleep 30
  done
  log "cell $id: new instance $new"
  cells_wait_ready "$id"
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
    case ${1:?cells deploy|upgrade|restart|replace|instance|wait-ready|lease} in
      deploy) cells_deploy ;;
      upgrade) cells_upgrade "${2:-}" ;;
      restart) cells_restart "${2:-}" ;;
      replace) cells_replace "${2:-}" ;;
      instance) instance_of "${2:?cells instance <id>}" ;;
      wait-ready) cells_wait_ready "${2:-}" ;;
      lease) echo "${P}: writer lease held by $(lease_holder)" ;;
      *) die "unknown cells command $1" ;;
    esac ;;
  install) for d in data-plane core-cell api-tier app-tier observability; do node_run "$ROOT/$d" npm ci --no-audit --no-fund --loglevel=error; done ;;
  build-ui) for d in app/ui smd-ui; do log "build $d"; node_run "$STRATO_PLATFORM_DIR/$d" bash -c 'npm ci --no-audit --no-fund --loglevel=error && npm run build'; done ;;
  publish-scripts)
    # What cell-bootstrap.sh installs from the NodeScripts asset, plus this repo's upgrade and health scripts.
    staging=$(mktemp -d)
    trap 'rm -rf "$staging"' EXIT
    find "$STRATO_PLATFORM_DIR/bin" -maxdepth 1 -type f -name 'strato-*' ! -name '*.md' ! -name strato-pg-migrate ! -name strato-patch-app -exec cp {} "$staging/" \;
    cp "$ROOT/core-cell/bootstrap/strato-cell-upgrade" "$ROOT/core-cell/bootstrap/strato-cell-health" "$staging/"
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
