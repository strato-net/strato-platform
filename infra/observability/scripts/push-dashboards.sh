#!/usr/bin/env bash
# Push the four boards in dashboards/ to the Managed Grafana workspace.
# GRAFANA_URL is the workspace URL (the stack's GrafanaUrl output) and
# GRAFANA_TOKEN a service-account token: create one with
#   aws grafana create-workspace-service-account --workspace-id <id> --name cdk --grafana-role ADMIN
#   aws grafana create-workspace-service-account-token --workspace-id <id> --service-account-id <sa> --name push --seconds-to-live 3600
# and export its key as GRAFANA_TOKEN for this shell only.
# The data source uids come from the workspace: pass them as
# DS_PROMETHEUS, DS_CLOUDWATCH, DS_CLOUDWATCH_LOGS and DS_XRAY (Grafana >
# Connections > Data sources). DS_CLOUDWATCH_LOGS is a second CloudWatch data
# source, for the infrastructure map's Logs Insights query alone (README).
set -euo pipefail
: "${GRAFANA_URL:?set GRAFANA_URL}"
: "${GRAFANA_TOKEN:?set GRAFANA_TOKEN}"
: "${DS_PROMETHEUS:?set DS_PROMETHEUS (data source uid)}"
: "${DS_CLOUDWATCH:?set DS_CLOUDWATCH (data source uid)}"
: "${DS_CLOUDWATCH_LOGS:?set DS_CLOUDWATCH_LOGS (uid of a second CloudWatch data source)}"
DS_XRAY="${DS_XRAY:-}"

cd "$(dirname "$0")/../dashboards"
for f in *.json; do
  # Each board is given exactly the inputs it declares.
  payload=$(jq -n --slurpfile d "$f" --arg p "$DS_PROMETHEUS" --arg c "$DS_CLOUDWATCH" --arg l "$DS_CLOUDWATCH_LOGS" --arg x "$DS_XRAY" '
    { DS_PROMETHEUS: $p, DS_CLOUDWATCH: $c, DS_CLOUDWATCH_LOGS: $l, DS_XRAY: $x } as $uid
    | {
        dashboard: $d[0],
        overwrite: true,
        folderId: 0,
        inputs: [($d[0].__inputs // [])[] | { name, type, pluginId, value: ($uid[.name] // "") }]
      }')
  echo "pushing $f"
  curl -fsS -X POST "$GRAFANA_URL/api/dashboards/import" \
    -H "Authorization: Bearer $GRAFANA_TOKEN" -H "Content-Type: application/json" \
    --data "$payload" > /dev/null
done
echo "done"
