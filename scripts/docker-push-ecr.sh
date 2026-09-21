#!/usr/bin/env bash

# Push locally built images to AWS ECR, tolerating immutable tags.
#
# ECR repositories with tag immutability reject a push of a tag that already
# exists ("... cannot be overwritten because the repository is immutable").
# `docker compose push` treats that as a hard failure, which breaks Jenkins
# re-runs of a build whose tags are already in ECR. This script:
#
#   1. Collects image refs from compose files (-f) and/or positional args, and
#      keeps only those living in an ECR registry (see --registry-glob). For our
#      *.push.ecr.yml files this is exactly the set of services with a `build:`
#      section - the third-party images (postgres, redis, ...) are not ours to push.
#   2. Skips any image whose tag already exists in the registry
#      (checked with `docker manifest inspect`, which reuses the `docker login`).
#   3. Pushes the rest one by one. If a push still fails with the immutable-tag
#      error (e.g. a race with a parallel build), it is logged and tolerated.
#      Any other push failure fails the script.
#
# Usage:
#   scripts/docker-push-ecr.sh [-f compose.yml]... [--dry-run] [--registry-glob GLOB] [IMAGE]...
#
# Examples:
#   scripts/docker-push-ecr.sh -f docker-compose.push.ecr.yml -f docker-compose.vault.push.ecr.yml
#   scripts/docker-push-ecr.sh 406773134706.dkr.ecr.us-east-1.amazonaws.com/strato/bridge:19.0-abc1234-0123456789ab
#
# Requires an authenticated docker CLI (run `aws ecr get-login-password | docker login ...` first).

set -euo pipefail

# Bash glob matched against each image ref; non-matching refs are skipped.
REGISTRY_GLOB="${ECR_REGISTRY_GLOB:-*.dkr.ecr.*.amazonaws.com/*}"
IMMUTABLE_TAG_MSG="cannot be overwritten because the repository is immutable"

DRY_RUN=false
COMPOSE_FILES=()
IMAGES=()

usage() {
  sed -n '3,/^$/p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit "${1:-1}"
}

log() { echo "[docker-push-ecr] $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      [[ $# -ge 2 ]] || { echo "error: $1 requires a compose file argument" >&2; usage; }
      COMPOSE_FILES+=("$2"); shift 2 ;;
    --registry-glob)
      [[ $# -ge 2 ]] || { echo "error: $1 requires a glob argument" >&2; usage; }
      REGISTRY_GLOB="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage 0 ;;
    --) shift; IMAGES+=("$@"); break ;;
    -*) echo "error: unknown option: $1" >&2; usage ;;
    *) IMAGES+=("$1"); shift ;;
  esac
done

if [[ ${#COMPOSE_FILES[@]} -eq 0 && ${#IMAGES[@]} -eq 0 ]]; then
  echo "error: nothing to push - pass -f <compose.yml> and/or image refs" >&2
  usage
fi

# Resolve image refs from compose files (env defaults like ${X:-img} are expanded by `config`).
for f in "${COMPOSE_FILES[@]}"; do
  [[ -f "$f" ]] || { echo "error: compose file not found: $f" >&2; exit 1; }
  log "collecting images from $f"
  if ! compose_images="$(docker compose -f "$f" config --images)"; then
    echo "error: failed to read images from $f" >&2
    exit 1
  fi
  while IFS= read -r img; do
    [[ -n "$img" ]] && IMAGES+=("$img")
  done <<< "$compose_images"
done

# Filter to the target registry and de-duplicate, preserving order.
TARGETS=()
for img in "${IMAGES[@]}"; do
  # shellcheck disable=SC2053  # intentional glob match
  if [[ "$img" != $REGISTRY_GLOB ]]; then
    log "skipping $img (not in registry glob '$REGISTRY_GLOB')"
    continue
  fi
  seen=false
  for t in "${TARGETS[@]+"${TARGETS[@]}"}"; do
    [[ "$t" == "$img" ]] && { seen=true; break; }
  done
  $seen || TARGETS+=("$img")
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  log "no images matched registry glob '$REGISTRY_GLOB' - nothing to push"
  exit 0
fi

pushed=0
skipped=0
FAILED=()

push_log="$(mktemp)"
trap 'rm -f "$push_log"' EXIT

for img in "${TARGETS[@]}"; do
  if docker manifest inspect "$img" >/dev/null 2>&1; then
    log "SKIP  $img (tag already exists in registry)"
    skipped=$((skipped + 1))
    continue
  fi

  if $DRY_RUN; then
    log "WOULD PUSH $img"
    pushed=$((pushed + 1))
    continue
  fi

  log "PUSH  $img"
  set +e
  docker push "$img" 2>&1 | tee "$push_log"
  rc=${PIPESTATUS[0]}
  set -e

  if [[ $rc -eq 0 ]]; then
    pushed=$((pushed + 1))
  elif grep -q "$IMMUTABLE_TAG_MSG" "$push_log"; then
    log "SKIP  $img (tag already exists in immutable repository - tolerated)"
    skipped=$((skipped + 1))
  else
    log "FAIL  $img (docker push exited $rc)"
    FAILED+=("$img")
  fi
done

log "done: pushed=$pushed skipped=$skipped failed=${#FAILED[@]}"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  for img in "${FAILED[@]}"; do echo "  failed: $img" >&2; done
  exit 1
fi
