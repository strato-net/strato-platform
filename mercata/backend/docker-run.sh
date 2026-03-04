#!/bin/sh
set -e

STRATO_HOSTNAME=${STRATO_HOSTNAME:-strato}
STRATO_PORT_API=${STRATO_PORT_API:-3000}
STRATO_API_URL="http://${STRATO_HOSTNAME}:${STRATO_PORT_API}/eth/v1.2"

echo "Waiting for STRATO node API to be available at ${STRATO_API_URL}..."
until wget -qO /dev/null --timeout=5 "${STRATO_API_URL}/stats/totaltx" 2>/dev/null; do
  echo "  STRATO not available yet. Retrying in 5s... ($(date))"
  sleep 5
done
echo "STRATO node API is available."

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

  if [ "${IS_SYsudo docker exec -it NCED}" = "true" ]; then
    echo "STRATO node is fully synced!"
    break
  fi

  echo "  Node is still syncing. Will check again in 30s... ($(date))"
  sleep 30
done

echo "Starting app-backend..."
exec node dist/app.js
