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
#   scripts/ha.sh <env> cells diff                cdk diff of every cell's stack
#   scripts/ha.sh <env> cells upgrade [<id>]      upgrade every cell (or one) in place, standbys first
#   scripts/ha.sh <env> cells restart [<id>]      restart every cell (or one) on the version it runs, standbys first
#   scripts/ha.sh <env> cells replace <id>        a new instance for the cell, from the latest snapshot
#   scripts/ha.sh <env> cells instance <id>       the cell's current instance id
#   scripts/ha.sh <env> cells wait-ready [<id>]   wait until cells follow the chain
#   scripts/ha.sh <env> cells lease               who holds the writer lease
#   scripts/ha.sh <env> images                    the image set of the strato-platform commit checked out, each image checked
#   scripts/ha.sh <env> install                   npm ci in every app
#   scripts/ha.sh <env> build-ui                  build app/ui and smd-ui for the front door
#   scripts/ha.sh <env> publish-scripts           node scripts and the cell upgrade and health scripts to the core tier's bucket
#   scripts/ha.sh <env> first-front-door          the front door where there is no app tier yet (without the app tier's routes) or no front door
#   scripts/ha.sh <env> wait-hostname             wait until the environment's hostname leads to the front door and answers as a synced node (HOSTNAME_WAIT_MINUTES, 720, for its DNS record)
#   scripts/ha.sh <env> smoke                     check the deployment through its front door
#   scripts/ha.sh <env> record <strato> <infra>   record the deployed image set and commits
#   scripts/ha.sh <env> state                     the commits last deployed
#
# Targets, in deploy order: data-plane, obs-core, core-nlb, the cells (the
# cells command), api-tier, app-tier, front-door, obs-alarms. Images come
# from STRATO_IMAGE, NGINX_IMAGE, POSTGREST_IMAGE, APEX_IMAGE, APP_NGINX_IMAGE
# and APP_BACKEND_IMAGE (the pipeline sources what the images command
# printed), or, only with HA_IMAGES=recorded, from the set last deployed.
# strato-platform is read from STRATO_PLATFORM_DIR, default ../strato-platform
# beside this repo.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
env_name=${1:?usage: scripts/ha.sh <env> <command> ...}
envfile="$ROOT/environments/$env_name.env"
shift
[[ -f $envfile ]] || { echo "ha.sh: no $envfile" >&2; exit 2; }

# --- The environment file, checked before anything is asked of AWS ---
# A setting missing from the file, a name this script does not read (a
# misspelt one would otherwise be ignored) or a value of the wrong shape stops
# every command here, not a deployment halfway through.
ENV_REQUIRED=(ENV_NAME AWS_REGION NETWORK CHAIN_ID NODE_HOSTNAME CERTIFICATE_ARN PG_ENGINE_VERSION PG_INSTANCE_CLASS PG_READERS
  CELLS CELL_INSTANCE_TYPE CELL_DATA_GIB SNAPSHOT_BUCKET SNAPSHOT_SOURCE VAULT_URL OAUTH_SECRET
  API_DESIRED_COUNT APP_DESIRED_COUNT OBSERVABILITY)
# Present in the file, but may be left empty: without a snapshot a cell syncs from the genesis block.
ENV_MAY_BE_EMPTY=(SNAPSHOT_BUCKET SNAPSHOT_SOURCE)
ENV_OPTIONAL=(BACKEND_SECRET BACKEND_SECRET_KEYS GRAFANA_ADMIN_GROUPS GRAFANA_VIEWER_GROUPS PARTNER_REFERRALS_URL PARTNER_INTERNAL_KEY_SECRET
  READY_TIMEOUT_MINUTES)
# Only the file sets them: a value inherited from the caller's shell (the
# pipeline exports ENV_NAME and AWS_REGION) would hide a missing line.
# READY_TIMEOUT_MINUTES alone may also come from the caller.
for name in "${ENV_REQUIRED[@]}" "${ENV_OPTIONAL[@]}"; do [[ $name == READY_TIMEOUT_MINUTES ]] || unset "$name"; done
# shellcheck source=/dev/null
source "$envfile"
env_check() {
  local name known k cell ids="" assigned problems=()
  assigned=$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$envfile")
  for name in $assigned; do
    known=false
    for k in "${ENV_REQUIRED[@]}" "${ENV_OPTIONAL[@]}"; do [[ $k == "$name" ]] && known=true; done
    [[ $known == true ]] || problems+=("$name is not a setting this script reads")
  done
  for name in "${ENV_REQUIRED[@]}"; do
    if ! grep -qx "$name" <<<"$assigned"; then problems+=("$name is missing"); continue; fi
    [[ -n ${!name:-} || " ${ENV_MAY_BE_EMPTY[*]} " == *" $name "* ]] || problems+=("$name is empty")
  done
  is() { [[ -z ${!1:-} || ${!1} =~ $2 ]] || problems+=("$1=${!1}: $3"); }
  [[ -z ${ENV_NAME:-} || $ENV_NAME == "$env_name" ]] || problems+=("ENV_NAME=$ENV_NAME, but the file is $env_name.env")
  # The same rules as the CDK apps (deploymentPrefix in lib/naming.ts, cellId in core-cell/lib/config.ts).
  is ENV_NAME '^[a-z][a-z0-9-]{0,14}[a-z0-9]$' "2 to 16 lowercase letters, digits or hyphens, starting with a letter and not ending with a hyphen"
  local label='[a-z0-9]([a-z0-9-]*[a-z0-9])?' url='^https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]+)?(/.*)?$'
  is NODE_HOSTNAME "^$label(\\.$label)+\$" "a full hostname, without scheme or path"
  is CERTIFICATE_ARN '^arn:aws[a-z-]*:acm:[a-z0-9-]+:[0-9]{12}:certificate/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' "arn:aws:acm:<region>:<account>:certificate/<id>"
  is VAULT_URL "$url" "a URL with a host"
  is PARTNER_REFERRALS_URL "$url" "a URL with a host"
  is OBSERVABILITY '^(true|false)$' "true or false"
  is AWS_REGION '^[a-z]{2}(-[a-z]+)+-[0-9]$' "an AWS region, like us-east-1"
  is NETWORK '^[a-z][a-z0-9-]*$' "a network name, like helium"
  for name in CELL_INSTANCE_TYPE PG_INSTANCE_CLASS; do is "$name" '^[a-z][a-z0-9-]*\.[a-z0-9-]+$' "an instance type, like m6i.xlarge"; done
  is PG_ENGINE_VERSION '^[0-9]+\.[0-9]+$' "an Aurora PostgreSQL version, like 14.18"
  is SNAPSHOT_BUCKET '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' "a bucket name"
  for name in OAUTH_SECRET BACKEND_SECRET PARTNER_INTERNAL_KEY_SECRET; do is "$name" '^[A-Za-z0-9/_+=.@:-]+$' "a Secrets Manager name or ARN"; done
  is BACKEND_SECRET_KEYS '^[A-Z0-9_]+( [A-Z0-9_]+)*$' "setting names separated by single spaces"
  for name in CHAIN_ID PG_READERS CELL_DATA_GIB API_DESIRED_COUNT APP_DESIRED_COUNT READY_TIMEOUT_MINUTES; do is "$name" '^[0-9]+$' "a whole number"; done
  for cell in ${CELLS:-}; do
    [[ $cell =~ ^[a-z][a-z0-9-]{0,30}:[a-z]{2}(-[a-z]+)+-[0-9][a-z]$ ]] || problems+=("CELLS: $cell is not <cellId>:<zone>, the id a short lowercase name starting with a letter")
    [[ " $ids " != *" ${cell%%:*} "* ]] || problems+=("CELLS: cell ${cell%%:*} is listed twice")
    ids+=" ${cell%%:*}"
  done
  [[ ${PARTNER_REFERRALS_URL:+set} == "${PARTNER_INTERNAL_KEY_SECRET:+set}" ]] \
    || problems+=("PARTNER_REFERRALS_URL and PARTNER_INTERNAL_KEY_SECRET go together: set both or neither")
  ((${#problems[@]} == 0)) && return 0
  echo "ha.sh: $envfile:" >&2
  printf '  %s\n' "${problems[@]}" >&2
  exit 2
}
env_check
: "${GRAFANA_ADMIN_GROUPS:=}" "${GRAFANA_VIEWER_GROUPS:=}"
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
# True only when CloudFormation says the stack is not there (or holds nothing:
# its creation was rolled back or never started). exists cannot tell that from
# a failed call, which is not enough where the answer decides what is deployed.
absent() {
  local s
  if s=$(aws cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>&1); then
    [[ $s == ROLLBACK_COMPLETE || $s == DELETE_COMPLETE || $s == REVIEW_IN_PROGRESS ]]
    return
  fi
  [[ $s == *"does not exist"* ]] || die "cannot tell whether $1 exists: $s"
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
# CloudFront's origin-facing addresses, comma-separated: with them and the VPC's
# range trusted, nginx behind the front door and a load balancer takes the
# client's address from X-Forwarded-For.
cloudfront_cidrs() {
  local id cidrs
  id=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
    --query 'PrefixLists[0].PrefixListId' --output text 2>/dev/null) || id=""
  [[ $id == pl-* ]] && cidrs=$(aws ec2 get-managed-prefix-list-entries --prefix-list-id "$id" --query 'sort(Entries[].Cidr)' --output text 2>/dev/null) || cidrs=""
  [[ -n $cidrs && $cidrs != None ]] || die "cannot read CloudFront's origin-facing prefix list (ec2:DescribeManagedPrefixLists, ec2:GetManagedPrefixListEntries)"
  printf '%s' "$cidrs" | tr -s '[:space:]' ,
}
ssm_get() { aws ssm get-parameter --name "$1" --query Parameter.Value --output text 2>/dev/null || true; }
# --value=: a value starting with "-" (a recorded cell context) would otherwise read as an option.
ssm_put() { aws ssm put-parameter --name "$1" --type String --tier Intelligent-Tiering --overwrite --value="$2" >/dev/null; }

# Where the node scripts are published and the cells read them: the bucket
# the core tier's stack owns, which nothing but this deployment writes.
node_scripts_s3() {
  local bucket
  # || exit: this runs inside $(...), where a failed lookup does not stop the function by itself.
  bucket=$(need "$P-core-nlb" NodeScriptsBucketName) || exit 1
  printf 's3://%s/node-scripts/' "$bucket"
}

cell_ids() { local c; for c in $CELLS; do echo "${c%%:*}"; done; }
cell_zone() { local c; for c in $CELLS; do [[ ${c%%:*} == "$1" ]] && echo "${c#*:}"; done; return 0; }
host_stack() { echo "$P-cell-$1-host"; }
FIRST_CELL=${CELLS%% *}
FIRST_CELL=${FIRST_CELL%%:*}
existing_cells() { local id; for id in $(cell_ids); do exists "$(host_stack "$id")" && echo "$id"; done; return 0; }

# The image set: from the environment (the pipeline sources what the images
# command printed) or, only when asked with HA_IMAGES=recorded, the one last
# deployed: for a diff, or a command by hand between deployments. Nothing
# falls back to the recorded set by itself: a deployment whose set went
# missing would bring the stacks to the previous images, pass, and be recorded
# under the new commit.
load_images() {
  local saved k v missing=""
  for k in $IMAGE_KEYS; do [[ -n ${!k:-} ]] || missing+=" $k"; done
  [[ -n $missing ]] || return 0
  [[ ${HA_IMAGES:-} == recorded ]] || die "no image set ($(echo $missing) unset): source what '$0 $ENV_NAME images' prints, or set HA_IMAGES=recorded for the set last deployed"
  saved=$(ssm_get "$STATE/images")
  for k in $missing; do
    v=$(sed -n "s/^$k=//p" <<<"$saved")
    [[ -n $v ]] || die "$k is not set and no image set has been deployed to $ENV_NAME yet"
    printf -v "$k" '%s' "$v"
  done
}

# The image set strato-platform's autobuild published for the commit checked
# out at STRATO_PLATFORM_DIR, under the names its Makefile computes (a
# print-<VAR> rule added from a second makefile; the node image by its commit
# alone); nothing is built. Prints KEY=image lines. A variable the Makefile no
# longer defines, or an image not
# published, stops here, before anything is deployed. The packages are public,
# so nothing logs in.
images() {
  local mk vars registry version entry key name hash image
  # <KEY>=<image name>:<the Makefile variable holding its content hash>. The
  # node image has none: it is taken by the tag the autobuild also gives it,
  # strato:<VERSION> (the Makefile's VERSION names the commit; what strato-up
  # --prebuilt resolves). Its hash covers tracked .cabal files that a build
  # regenerates, so the hash the autobuild tagged it with is not always the
  # one a clean checkout computes.
  local map="STRATO_IMAGE=strato: NGINX_IMAGE=nginx:HASH_NGINX POSTGREST_IMAGE=postgrest:HASH_POSTGREST APEX_IMAGE=apex:HASH_APEX
    APP_NGINX_IMAGE=app-nginx:HASH_APP_NGINX APP_BACKEND_IMAGE=app-backend:HASH_APP_BACKEND PROMETHEUS_IMAGE=prometheus:HASH_PROMETHEUS"
  [[ -f $STRATO_PLATFORM_DIR/Makefile ]] || die "$STRATO_PLATFORM_DIR has no Makefile; set STRATO_PLATFORM_DIR"
  mk=$(mktemp)
  printf 'print-%%:\n\t@echo $*=$($*)\n' > "$mk"
  vars=$(make -s --no-print-directory -C "$STRATO_PLATFORM_DIR" -f Makefile -f "$mk" print-REPO_GHCR_URL print-VERSION \
    $(for entry in $map; do [[ -z ${entry##*:} ]] || echo "print-${entry##*:}"; done)) || { rm -f "$mk"; die "cannot read the image names from $STRATO_PLATFORM_DIR/Makefile"; }
  rm -f "$mk"
  makefile_var() { sed -n "s/^$1=//p" <<<"$vars" | head -1; }
  registry=$(makefile_var REPO_GHCR_URL)
  version=$(makefile_var VERSION)
  [[ -n $registry && -n $version ]] || die "strato-platform's Makefile gave no REPO_GHCR_URL or VERSION"
  log "image set of strato-platform $(git -C "$STRATO_PLATFORM_DIR" rev-parse --short=10 HEAD 2>/dev/null || echo '?') ($version)"
  for entry in $map; do
    key=${entry%%=*}
    name=${entry#*=}
    image=$registry${name%%:*}:$version
    if [[ -n ${name##*:} ]]; then
      hash=$(makefile_var "${name##*:}")
      [[ -n $hash ]] || die "strato-platform's Makefile no longer defines ${name##*:} (for $key)"
      image+=-$hash
    fi
    docker manifest inspect "$image" >/dev/null 2>&1 || die "$image is not published: wait for strato-platform's autobuild of this commit"
    echo "$key=$image"
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
  local config policy
  config=$(need "$P-obs-core" EcsCollectorParameter)
  policy=$(need "$P-obs-core" SidecarPolicyArn)
  ctx+=(-c otelConfigParameterName="$config" -c otelSidecarPolicyArn="$policy")
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
  local id=$1 pg="$P-data-postgres" core="$P-core-nlb" login login_secret admin_secret
  local vpc writer reader pg_sg nlb_sg ingress_tg prometheus_tg grafana_tg scripts
  load_images
  # Each on its own line: a failed lookup inside the array below would not stop the script.
  login=$(need "$pg" NodeLogin)
  login_secret=$(need "$pg" NodeLoginSecretName)
  admin_secret=$(need "$pg" SecretName)
  vpc=$(vpc_id)
  writer=$(need "$pg" WriterEndpoint)
  reader=$(need "$pg" ReaderEndpoint)
  pg_sg=$(need "$pg" ClusterSecurityGroupId)
  nlb_sg=$(need "$core" SecurityGroupId)
  ingress_tg=$(need "$core" IngressTargetGroupArn)
  scripts=$(node_scripts_s3)
  ctx=(-c envName="$ENV_NAME" -c cellId="$id" -c role=core -c network="$NETWORK"
    -c vpcId="$vpc" -c subnetType=public -c availabilityZone="$(cell_zone "$id")"
    -c instanceType="$CELL_INSTANCE_TYPE" -c dataVolumeGiB="$CELL_DATA_GIB"
    -c stratoImage="$STRATO_IMAGE" -c stratoImageParameter="$CELL_IMAGE"
    -c postgresWriterHost="$writer" -c postgresReaderHost="$reader"
    -c postgresSecurityGroupId="$pg_sg"
    -c postgresUser="$login" -c postgresSecretName="$login_secret" -c postgresAdminSecretName="$admin_secret"
    -c peerStore=sqlite -c validatorBehavior=false -c autoPromote=true -c seedEmptyCluster=true
    -c oauthSecretName="$OAUTH_SECRET" -c extraSetupFlags="--vaultUrl=$VAULT_URL"
    -c snapshotBucket="$SNAPSHOT_BUCKET" -c snapshotSource="$SNAPSHOT_SOURCE"
    -c extraBinariesS3="$scripts" -c exposePrometheus=true
    -c coreLoadBalancerSecurityGroupId="$nlb_sg" -c ingressTargetGroupArn="$ingress_tg")
  # The first cell publishes the node config for the API tier, runs Grafana and is the one whose Prometheus apex reads.
  if [[ $id == "$FIRST_CELL" ]]; then
    prometheus_tg=$(need "$core" PrometheusTargetGroupArn)
    ctx+=(-c ethconfParameterName="/$P/api/ethconf-base64" -c grafana=true
      -c grafanaPublicUrl="https://$NODE_HOSTNAME/grafana/" -c grafanaAdminGroups="$GRAFANA_ADMIN_GROUPS" -c grafanaViewerGroups="$GRAFANA_VIEWER_GROUPS"
      -c prometheusTargetGroupArn="$prometheus_tg")
    # The Grafana target group gets its load balancer with the API tier, which
    # is deployed after the cells: the cell joins it from the next run on.
    # An if, not &&: a failed lookup in an && list would not stop the script.
    if exists "$P-api-tier"; then
      grafana_tg=$(need "$core" GrafanaTargetGroupArn)
      ctx+=(-c grafanaTargetGroupArn="$grafana_tg")
    fi
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

# The core tier's load balancer, target groups and node scripts bucket: deployed before the cells, which register in them and read it.
ctx_core_nlb() {
  refuse_plain_instances
  local vpc
  vpc=$(vpc_id)
  ctx=(-c envName="$ENV_NAME" -c coreNlb=true -c vpcId="$vpc")
}

ctx_api() {
  load_images
  local pg="$P-data-postgres" cell core login login_secret cdn
  local vpc writer reader pg_sg cell_sg nlb_sg grafana_tg
  cell=$(host_stack "$FIRST_CELL")
  # Each on its own line: a failed lookup inside the array below would not stop the script.
  login=$(need "$pg" NodeLogin)
  login_secret=$(need "$pg" NodeLoginSecretName)
  cdn=$(cloudfront_cidrs)
  vpc=$(vpc_id)
  writer=$(need "$pg" WriterEndpoint)
  reader=$(need "$pg" ReaderEndpoint)
  pg_sg=$(need "$pg" ClusterSecurityGroupId)
  cell_sg=$(need "$cell" SecurityGroupId)
  nlb_sg=$(need "$P-core-nlb" SecurityGroupId)
  grafana_tg=$(need "$P-core-nlb" GrafanaTargetGroupArn)
  # The cells are reached through their load balancer: a submit goes to one healthy cell.
  core=$(need "$P-core-nlb" DnsName)
  ctx=(-c envName="$ENV_NAME" -c vpcId="$vpc" -c clusterName="$P"
    -c stratoImage="$STRATO_IMAGE" -c nginxImage="$NGINX_IMAGE" -c postgrestImage="$POSTGREST_IMAGE" -c apexImage="$APEX_IMAGE"
    -c postgresWriterHost="$writer" -c postgresReaderHost="$reader"
    -c postgresUser="$login" -c postgresSecretName="$login_secret"
    -c postgresSecurityGroupId="$pg_sg" -c coreSecurityGroupId="$cell_sg"
    -c ingressUrls="http://$core:8600" -c coreLoadBalancerSecurityGroupId="$nlb_sg"
    -c ethconfParameterName="/$P/api/ethconf-base64"
    -c createSessionSecret=true -c oauthJsonSecretName="$OAUTH_SECRET" -c csrfStateless=true
    -c desiredCount="$API_DESIRED_COUNT" -c albCertificateArn="$CERTIFICATE_ARN" -c chainId="$CHAIN_ID" -c networkName="$NETWORK"
    -c prometheusHost="$core:9090" -c grafanaTargetGroupArn="$grafana_tg"
    -c trustedProxyCidrs="$cdn")
  otel_ecs
}
# The partner referrals service follows the network: one per network, each
# with its own internal key (a plain-string secret that service reads too).
# The backend gets its URL and that key. An environment file names another
# service with PARTNER_REFERRALS_URL and PARTNER_INTERNAL_KEY_SECRET; a network
# without one gets neither and records no referrals. helium's address is the
# one ECS Express generated for the service: a recreated service has another.
partner_referrals() {
  local url=${PARTNER_REFERRALS_URL:-} key=${PARTNER_INTERNAL_KEY_SECRET:-}
  if [[ -z $url && -z $key ]]; then
    case $NETWORK in
      helium) url=https://partner-referrals.example.invalid key=helium-partner-referrals/internal-key.example ;;
      upquark) url=https://partner-api.strato.nexus key=upquark-partner-referrals/internal-key.example ;;
    esac
  fi
  [[ -z $url && -z $key ]] || ctx+=(-c partnerReferralsUrl="$url" -c partnerInternalKeySecretName="$key")
}

ctx_app() {
  load_images
  local pg="$P-data-postgres" session cluster login login_secret cdn vpc reader pg_sg
  # The API tier mints the session cookie and this tier decrypts it: its
  # secret, by complete ARN (a name-only reference reads the random suffix
  # as part of the name).
  session=$(aws secretsmanager describe-secret --secret-id "$P/api/session-secret" --query ARN --output text 2>/dev/null) \
    || die "$P/api/session-secret does not exist: deploy api-tier first"
  # Each on its own line: a failed lookup inside the array below would not stop the script.
  cluster=$(need "$P-api-tier" ClusterName)
  login=$(need "$pg" NodeLogin)
  login_secret=$(need "$pg" NodeLoginSecretName)
  cdn=$(cloudfront_cidrs)
  vpc=$(vpc_id)
  reader=$(need "$pg" ReaderEndpoint)
  pg_sg=$(need "$pg" ClusterSecurityGroupId)
  ctx=(-c envName="$ENV_NAME" -c vpcId="$vpc" -c clusterName="$cluster"
    -c nginxImage="$APP_NGINX_IMAGE" -c backendImage="$APP_BACKEND_IMAGE"
    -c nodeUrl="https://$NODE_HOSTNAME" -c publicScheme=https -c trustedProxyCidrs="$cdn"
    -c postgresHost="$reader" -c postgresUser="$login"
    -c postgresPasswordSecretName="$login_secret" -c postgresPasswordJsonKey=password
    -c postgresSecurityGroupId="$pg_sg" -c chainId="$CHAIN_ID" -c networkName="$NETWORK"
    -c oauthSecretName="$OAUTH_SECRET" -c csrfStateless=true -c createSessionSecret=false -c sessionSecretName="$session"
    -c ethconfParameterName="/$P/api/ethconf-base64" -c httpPort=80 -c ui=false -c deployUi=false
    -c albCertificateArn="$CERTIFICATE_ARN" -c desiredCount="$APP_DESIRED_COUNT")
  if [[ -n ${BACKEND_SECRET:-} && -n ${BACKEND_SECRET_KEYS:-} ]] && secret_exists "$BACKEND_SECRET"; then
    ctx+=(-c backendSecretName="$BACKEND_SECRET" -c backendSecretKeys="$(echo $BACKEND_SECRET_KEYS | tr ' ' ,)")
  fi
  partner_referrals
  otel_ecs
}

# without-app-tier: the front door of an environment whose app tier does not
# exist yet (first_front_door); every other deployment names the app tier.
ctx_front_door() {
  ctx_api
  local api_origin app_origin
  api_origin=$(need "$P-api-tier" AlbDnsName)
  ctx+=(-c frontDoorDomainName="$NODE_HOSTNAME" -c frontDoorCertificateArn="$CERTIFICATE_ARN"
    -c apiOriginDomainName="$api_origin" -c deployAppUi=true -c deploySmdUi=true)
  [[ ${1:-} == without-app-tier ]] && return 0
  app_origin=$(need "$P-app-tier" AlbDnsName)
  ctx+=(-c appOriginDomainName="$app_origin")
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

# A stack whose creation was rolled back holds nothing, and cdk deploy deletes
# it to create it again. One with termination protection refuses that, and
# every later run would stop there: lift the protection of such a stack first
# (the new stack gets its own). This identity may only read the deployment's
# stacks; the CDK deploy role, which it assumes as cdk does, may change them.
unprotect_rolled_back() {
  local stack state account creds key secret token
  for stack in "$@"; do
    [[ $stack != -* ]] || continue
    state=$(aws cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].[StackStatus,EnableTerminationProtection]' --output text 2>/dev/null) || continue
    [[ $(tr 'A-Z\t' 'a-z ' <<<"$state") == "rollback_complete true" ]] || continue
    log "$stack: its creation was rolled back; lifting its termination protection so that the deploy can replace it"
    account=$(aws sts get-caller-identity --query Account --output text)
    creds=$(aws sts assume-role --role-arn "arn:aws:iam::$account:role/cdk-hnb659fds-deploy-role-$account-$AWS_REGION" --role-session-name ha-sh \
      --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text) || die "cannot assume the CDK deploy role to lift the termination protection of $stack"
    read -r key secret token <<<"$creds"
    AWS_ACCESS_KEY_ID=$key AWS_SECRET_ACCESS_KEY=$secret AWS_SESSION_TOKEN=$token \
      aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name "$stack" >/dev/null
  done
}

deploy() {
  local target dir stacks ctx skip
  for target in "$@"; do
    resolve "$target"
    [[ -z $skip ]] || { log "skip $target: $skip"; continue; }
    log "deploy $target: ${stacks[*]}"
    unprotect_rolled_back "${stacks[@]}"
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
    unprotect_rolled_back "$P-cell-$id-network" "$P-cell-$id-host"
    cdk_in core-cell deploy "$P-cell-$id-network" "$P-cell-$id-host" --require-approval never --progress events "${ctx[@]}"
    if [[ $new == true ]]; then cells_wait_ready "$id"; fi
  done
}

# What cells deploy would change, for the pipeline's dry run.
cells_diff() {
  local id ctx
  for id in $(cell_ids); do
    ctx_cell "$id"
    cdk_in core-cell diff "$P-cell-$id-network" "$P-cell-$id-host" "${ctx[@]}"
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
# unhealthy, and the new one restores the latest snapshot. Refused only for
# the one healthy cell behind the load balancer, which would leave none for
# as long as a restore and a catch-up take. A cell that is not serving has
# nothing to lose: that is also the way out for a first cell whose load of
# the cluster failed, which has no healthy peer yet.
cells_replace() {
  local id=${1:?cells replace <id>} old new healthy deadline
  exists "$(host_stack "$id")" || die "no cell $id"
  old=$(instance_of "$id")
  healthy=$(aws elbv2 describe-target-health --target-group-arn "$(need "$P-core-nlb" IngressTargetGroupArn)" \
    --query "TargetHealthDescriptions[?TargetHealth.State=='healthy'].Target.Id" --output text)
  [[ -n $old && $(echo $healthy) == "$old" ]] && die "cell $id is the only healthy cell behind the load balancer: replacing it would leave none"
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

# --- The first deployment of an environment: the hostname before the app tier ---
# The app backend starts only once https://NODE_HOSTNAME answers as a synced
# node, and the front door that serves that name sends the backend's paths to
# the app tier: each needs the other. So where there is no app tier yet, the
# front door goes up without its paths, and wait_hostname holds the app tier
# back until the name answers (its DNS record is set by hand). The front door
# is deployed again, with the app tier, after it. A front door that is
# missing beside an app tier (a run that stopped between the two) is created
# with the app tier's paths, or no later run would get past wait_hostname.
# With both in place nothing is deployed here: a front door must never lose
# those paths.
first_front_door() {
  local ctx mode=""
  if absent "$P-app-tier"; then
    mode=without-app-tier
    log "no app tier yet: deploying the front door without the app tier's paths, for the hostname to be pointed at"
  elif absent "$P-api-frontdoor"; then
    log "the app tier exists and the front door does not: deploying the front door"
  else
    log "the app tier and the front door exist: the front door is deployed after the app tier, as on every run"
    return 0
  fi
  ctx_front_door "$mode"
  cdk_in api-tier deploy "$P-api-frontdoor" --exclusively --require-approval never --progress events "${ctx[@]}"
}

# Through the name as the app backend resolves it, not through CloudFront by
# name as smoke does, and only once the name leads to this front door: where
# the environment takes over the name of a running node, that node answers as
# synced until the record is changed. The front door itself gets 30 tries a
# minute apart to serve a synced node (the cells follow the chain and the API
# tier is up by now); the DNS record, which a person sets,
# HOSTNAME_WAIT_MINUTES (720).
wait_hostname() {
  local url=https://$NODE_HOSTNAME/strato-api/eth/v1.2/metadata dist target limit=${HOSTNAME_WAIT_MINUTES:-720} deadline down=0 seen
  [[ $limit =~ ^[0-9]+$ ]] || die "HOSTNAME_WAIT_MINUTES has to be a whole number, not '$limit'"
  command -v dig >/dev/null || die "wait-hostname needs dig, to see where $NODE_HOSTNAME leads"
  dist=$(need "$P-api-frontdoor" DistributionDomainName)
  target=$(tr 'A-Z' 'a-z' <<<"$dist")
  synced() {
    curl -fsS -m 20 -A strato-ha-smoke/1.0 "$@" "$url" 2>/dev/null \
      | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("isSynced") is True else 1)' 2>/dev/null
  }
  deadline=$(( $(date +%s) + limit * 60 ))
  while :; do
    # The name's CNAME chain and addresses, on one line, in lower case.
    seen=$(dig +short "$NODE_HOSTNAME" 2>/dev/null | tr 'A-Z\n' 'a-z ' | sed 's/ *$//') || true
    if [[ " $seen " == *" $target. "* ]] && synced; then break; fi
    if synced --connect-to "$NODE_HOSTNAME:443:$dist:443"; then
      down=0
      (( $(date +%s) < deadline )) || die "$NODE_HOSTNAME did not reach the front door in $limit minutes: its DNS record has to be a CNAME to $dist (the name leads to ${seen:-nothing})"
      log "waiting for the DNS record of $NODE_HOSTNAME: it has to be a CNAME to $dist (the name leads to ${seen:-nothing})"
    else
      (( ++down <= 30 )) || die "the front door $dist does not serve a synced node at /strato-api/eth/v1.2/metadata"
      log "waiting: the front door $dist does not serve a synced node yet"
    fi
    sleep 60
  done
  log "https://$NODE_HOSTNAME leads to the front door and answers as a synced node"
}

# --- Front door checks: through CloudFront by name, whatever the hostname's DNS says ---
smoke() {
  local dist url=https://$NODE_HOSTNAME
  dist=$(need "$P-api-frontdoor" DistributionDomainName)
  c() { curl -fsS -m 30 -A strato-ha-smoke/1.0 --connect-to "$NODE_HOSTNAME:443:$dist:443" "$@"; }
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
    case ${1:?cells deploy|diff|upgrade|restart|replace|instance|wait-ready|lease} in
      deploy) cells_deploy ;;
      diff) cells_diff ;;
      upgrade) cells_upgrade "${2:-}" ;;
      restart) cells_restart "${2:-}" ;;
      replace) cells_replace "${2:-}" ;;
      instance) instance_of "${2:?cells instance <id>}" ;;
      wait-ready) cells_wait_ready "${2:-}" ;;
      lease) echo "${P}: writer lease held by $(lease_holder)" ;;
      *) die "unknown cells command $1" ;;
    esac ;;
  images) images ;;
  install) for d in data-plane core-cell api-tier app-tier observability; do node_run "$ROOT/$d" npm ci --no-audit --no-fund --loglevel=error; done ;;
  build-ui) for d in app/ui smd-ui; do log "build $d"; node_run "$STRATO_PLATFORM_DIR/$d" bash -c 'npm ci --no-audit --no-fund --loglevel=error && npm run build'; done ;;
  publish-scripts)
    # What cell-bootstrap.sh installs from the NodeScripts asset, plus this repo's upgrade and health scripts.
    scripts=$(node_scripts_s3)
    staging=$(mktemp -d)
    trap 'rm -rf "$staging"' EXIT
    find "$STRATO_PLATFORM_DIR/bin" -maxdepth 1 -type f -name 'strato-*' ! -name '*.md' ! -name strato-pg-migrate ! -name strato-patch-app -exec cp {} "$staging/" \;
    cp "$ROOT/core-cell/bootstrap/strato-cell-upgrade" "$ROOT/core-cell/bootstrap/strato-cell-health" "$staging/"
    aws s3 sync --delete --only-show-errors "$staging/" "$scripts"
    log "published $(ls "$staging" | wc -l | tr -d ' ') scripts to $scripts" ;;
  first-front-door) first_front_door ;;
  wait-hostname) wait_hostname ;;
  smoke) smoke ;;
  record)
    load_images
    ssm_put "$STATE/images" "$(for k in $IMAGE_KEYS; do echo "$k=${!k}"; done)"
    ssm_put "$STATE/commits" "strato-platform=${1:?strato-platform commit} ha-infra=${2:?ha-infra commit}" ;;
  state) ssm_get "$STATE/commits" ;;
  *) die "unknown command $cmd" ;;
esac
