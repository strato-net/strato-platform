#!/usr/bin/env bash
# Push the four boards in dashboards/ to the Managed Grafana workspace.
# GRAFANA_URL is the workspace URL (the stack's GrafanaUrl output) and
# GRAFANA_TOKEN a service-account token: create one with
#   aws grafana create-workspace-service-account --workspace-id <id> --name cdk --grafana-role ADMIN
#   aws grafana create-workspace-service-account-token --workspace-id <id> --service-account-id <sa> --name push --seconds-to-live 3600
# and export its key as GRAFANA_TOKEN for this shell only.
# The data source uids come from the workspace: pass them as
# DS_PROMETHEUS, DS_CLOUDWATCH and DS_XRAY (Grafana > Connections > Data sources).
set -euo pipefail
: "${GRAFANA_URL:?set GRAFANA_URL}"
: "${GRAFANA_TOKEN:?set GRAFANA_TOKEN}"
: "${DS_PROMETHEUS:?set DS_PROMETHEUS (data source uid)}"
: "${DS_CLOUDWATCH:?set DS_CLOUDWATCH (data source uid)}"
DS_XRAY="${DS_XRAY:-}"

cd "$(dirname "$0")/../dashboards"
for f in *.json; do
  payload=$(jq -n --slurpfile d "$f" --arg p "$DS_PROMETHEUS" --arg c "$DS_CLOUDWATCH" --arg x "$DS_XRAY" '{
    dashboard: $d[0],
    overwrite: true,
    folderId: 0,
    inputs: [
      { name: "DS_PROMETHEUS", type: "datasource", pluginId: "prometheus", value: $p },
      { name: "DS_CLOUDWATCH", type: "datasource", pluginId: "cloudwatch", value: $c },
      { name: "DS_XRAY", type: "datasource", pluginId: "grafana-x-ray-datasource", value: $x }
    ]
  }')
  echo "pushing $f"
  curl -fsS -X POST "$GRAFANA_URL/api/dashboards/import" \
    -H "Authorization: Bearer $GRAFANA_TOKEN" -H "Content-Type: application/json" \
    --data "$payload" > /dev/null
done
echo "done"
