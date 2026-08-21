// Uploaded to the tracking server and executed over SSH on every deploy.
// Args: REPO_DIR BRANCH SHA COMPOSE_FILE "MAKE TARGETS" [HEALTH_URL] [ENV_FILE] [COMPOSE_PROFILES] [UP_COMMAND]
// Builds the tracking images for the requested commit, restarts the compose
// stack, health-checks it, and rolls back to the previous checkout on failure.
export const REMOTE_DEPLOY_SCRIPT = `#!/usr/bin/env bash
set -uo pipefail
REPO_DIR="$1"; BRANCH="$2"; SHA="$3"; COMPOSE_FILE="$4"; MAKE_TARGETS="$5"
HEALTH_URL="\${6:-}"; ENV_FILE="\${7:-}"; PROFILES="\${8:-}"; UP_COMMAND="\${9:-}"

cd "$REPO_DIR" || { echo "repo dir $REPO_DIR missing"; exit 2; }
[ -n "$PROFILES" ] && export COMPOSE_PROFILES="$PROFILES"

compose() {
  local args=(-f "$COMPOSE_FILE")
  [ -n "$ENV_FILE" ] && args+=(--env-file "$ENV_FILE")
  docker compose "\${args[@]}" "$@"
}

PREV_SHA=$(git rev-parse HEAD)
PREV_REF=$(git symbolic-ref --short -q HEAD || echo "$PREV_SHA")
echo "==> current checkout: $PREV_REF ($PREV_SHA)"
echo "==> target: $BRANCH @ $SHA"

if ! git fetch --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"; then
  echo "git fetch failed"; exit 3
fi
if ! git checkout -q -B "$BRANCH" "$SHA"; then
  echo "git checkout $SHA failed (dirty working tree?)"; git status --short | head -20; exit 3
fi

build_and_up() {
  echo "==> make $MAKE_TARGETS"
  make $MAKE_TARGETS || return 1
  if [ -n "$UP_COMMAND" ]; then
    echo "==> $UP_COMMAND"
    bash -c "$UP_COMMAND" || return 1
  else
    echo "==> docker compose up -d"
    compose up -d --remove-orphans || return 1
  fi
  return 0
}

health() {
  [ -z "$HEALTH_URL" ] && { echo "==> no health url configured; skipping health check"; return 0; }
  echo "==> health check $HEALTH_URL"
  for i in $(seq 1 36); do
    if curl -fsSk --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then echo "healthy after $i checks"; return 0; fi
    sleep 5
  done
  echo "health check FAILED"; return 1
}

if build_and_up && health; then
  echo "==> DEPLOY_OK $SHA"
  compose ps
  exit 0
fi

echo "==> deploy of $SHA failed; rolling back to $PREV_REF ($PREV_SHA)"
if [ "$PREV_REF" != "$PREV_SHA" ]; then
  git checkout -q "$PREV_REF" && git reset -q --hard "$PREV_SHA"
else
  git checkout -q "$PREV_SHA"
fi
build_and_up || echo "WARNING: rollback build/up failed"
health || echo "WARNING: rollback health check failed"
compose ps || true
echo "==> DEPLOY_ROLLED_BACK"
exit 1
`;
