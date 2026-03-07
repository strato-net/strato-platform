#!/bin/sh
set -e

# External-node mode: when NODE_URL is provided, skip local STRATO availability/sync checks.
if [ -n "${NODE_URL}" ]; then
  echo "NODE_URL is set (${NODE_URL}). Skipping local STRATO wait/sync checks."
  echo "Starting app-backend..."
  exec node dist/app.js
fi

STRATO_HOSTNAME=${STRATO_HOSTNAME:-strato}
STRATO_PORT_API=${STRATO_PORT_API:-3000}
STRATO_API_URL="http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2"

echo "Waiting for STRATO node to finish syncing (checking ${STRATO_API_URL}/metadata for isSynced=true)..."
echo "  This may take a long time if the node is catching up with the network."
while true; do
  IS_SYNCED=$(wget -qO- --timeout=10 "${STRATO_API_URL}/metadata" 2>/dev/null | node -e "
    let d='';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => {
      try {
        const m = JSON.parse(d);
        console.log(m.isSynced === true ? 'true' : 'false');
      } catch(e) {
        console.log('false');
      }
    });
  " 2>/dev/null || echo "false")

  if [ "${IS_SYNCED}" = "true" ]; then
    echo "STRATO node is fully synced!"
    break
  fi

  echo "  Node is still syncing. Will check again in 30s... ($(date))"
  sleep 30
done

echo "Starting app-backend..."
exec node dist/app.js
