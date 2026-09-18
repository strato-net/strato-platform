#!/bin/bash
# Writes Grafana's provisioning from the task's environment, then starts it.
#   AWS_REGION, PROMETHEUS_URL (the Managed Prometheus workspace endpoint)
#   GRAFANA_PUBLIC_URL, GRAFANA_ADMIN_GROUPS, GRAFANA_VIEWER_GROUPS, FRONTEND_LABELS
#   OAUTH_DISCOVERY_URL, OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, GRAFANA_ADMIN_PASSWORD (task secrets)
set -euo pipefail
log() { echo "strato-grafana: $*"; }
P=/etc/strato-grafana/provisioning
D=/var/lib/strato-dashboards
mkdir -p $P/datasources $P/dashboards

# Every data source signs with the task role. The second CloudWatch source
# serves the tier map's Logs Insights query: queries sharing a data source
# share a request id, and Grafana's frontend cancels the Logs StartQuery when
# the panel's metric request goes out.
cat > $P/datasources/strato.yaml <<YAML
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: ${PROMETHEUS_URL%/}
    isDefault: true
    jsonData: { httpMethod: POST, sigV4Auth: true, sigV4AuthType: default, sigV4Region: $AWS_REGION }
  - name: CloudWatch
    uid: cloudwatch
    type: cloudwatch
    access: proxy
    jsonData: { authType: default, defaultRegion: $AWS_REGION }
  - name: CloudWatch Logs
    uid: cloudwatch-logs
    type: cloudwatch
    access: proxy
    jsonData: { authType: default, defaultRegion: $AWS_REGION }
  - name: X-Ray
    uid: xray
    type: grafana-x-ray-datasource
    access: proxy
    jsonData: { authType: default, defaultRegion: $AWS_REGION }
YAML
cat > $P/dashboards/strato.yaml <<YAML
apiVersion: 1
providers:
  - name: strato
    folder: STRATO
    type: file
    options: { path: $D }
YAML

# The dashboards are Grafana exports with data source inputs; bind them. The
# env label is an external label of Managed Prometheus, so \$env answers here
# and nothing else needs rewriting (compare the cell's bootstrap).
for f in /usr/share/strato/dashboards/*.json; do
  sed -e 's/\${DS_PROMETHEUS}/prometheus/g' -e 's/\${DS_CLOUDWATCH}/cloudwatch/g' \
      -e 's/\${DS_CLOUDWATCH_LOGS}/cloudwatch-logs/g' -e 's/\${DS_XRAY}/xray/g' "$f" > "$D/$(basename "$f")"
done
if [[ -n "${FRONTEND_LABELS:-}" ]]; then
  for f in $D/*.json; do
    jq --arg v "$FRONTEND_LABELS" '(.templating.list[]? | select(.name == "frontend_labels")) |= (.query = $v | .current = {text: $v, value: $v})' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
fi

# Secrets go to files Grafana reads itself, and leave this environment.
umask 077
printf '%s' "${GRAFANA_ADMIN_PASSWORD:?}" > /etc/strato-grafana/admin-password
export GF_SECURITY_ADMIN_PASSWORD__FILE=/etc/strato-grafana/admin-password
unset GRAFANA_ADMIN_PASSWORD

# This Grafana is reached from the internet, so anonymous access is off before
# anything below can fail: if the Keycloak login cannot be set up, what is left
# is the admin password form, not an open dashboard.
export GF_AUTH_ANONYMOUS_ENABLED=false
export GF_AUTH_SIGV4_AUTH_ENABLED=true
export GF_SERVER_ROOT_URL="${GRAFANA_PUBLIC_URL:?}"
export GF_SERVER_SERVE_FROM_SUB_PATH=true
[[ "$GRAFANA_PUBLIC_URL" == https://* ]] && export GF_SECURITY_COOKIE_SECURE=true

# Endpoints come from the realm's discovery document rather than being
# assembled from the issuer by hand. The whitelist is group membership:
# role_attribute_path resolves to a role only for the named groups, and with
# role_attribute_strict a user in none of them is refused rather than let in
# with a default role. groups[] comes from a Keycloak group-membership mapper
# on the client.
if [[ -n "${OAUTH_DISCOVERY_URL:-}" ]]; then
  disco=$(curl -fsS --max-time 20 "$OAUTH_DISCOVERY_URL" || true)
  auth_url=$(jq -r '.authorization_endpoint // empty' <<<"$disco" 2>/dev/null || true)
  token_url=$(jq -r '.token_endpoint // empty' <<<"$disco" 2>/dev/null || true)
  api_url=$(jq -r '.userinfo_endpoint // empty' <<<"$disco" 2>/dev/null || true)
  if [[ -n "$auth_url" && -n "$token_url" && -n "$api_url" ]]; then
    printf '%s' "${OAUTH_CLIENT_SECRET:?}" > /etc/strato-grafana/oauth-client-secret
    # With no group named, nobody maps to a role and strict refuses everyone.
    role_path="''"
    admin_expr=""; viewer_expr=""
    for g in ${GRAFANA_ADMIN_GROUPS//,/ }; do admin_expr+="contains(groups[*], '$g') || "; done
    for g in ${GRAFANA_VIEWER_GROUPS//,/ }; do viewer_expr+="contains(groups[*], '$g') || "; done
    admin_expr=${admin_expr% || }; viewer_expr=${viewer_expr% || }
    if [[ -n "$admin_expr" && -n "$viewer_expr" ]]; then role_path="($admin_expr) && 'Admin' || ($viewer_expr) && 'Viewer' || ''"
    elif [[ -n "$admin_expr" ]]; then role_path="($admin_expr) && 'Admin' || ''"
    elif [[ -n "$viewer_expr" ]]; then role_path="($viewer_expr) && 'Viewer' || ''"
    fi
    export GF_AUTH_GENERIC_OAUTH_ENABLED=true GF_AUTH_GENERIC_OAUTH_NAME=Keycloak
    export GF_AUTH_GENERIC_OAUTH_CLIENT_ID="$OAUTH_CLIENT_ID"
    export GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET__FILE=/etc/strato-grafana/oauth-client-secret
    export GF_AUTH_GENERIC_OAUTH_SCOPES="openid email profile"
    export GF_AUTH_GENERIC_OAUTH_AUTH_URL="$auth_url" GF_AUTH_GENERIC_OAUTH_TOKEN_URL="$token_url" GF_AUTH_GENERIC_OAUTH_API_URL="$api_url"
    export GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH="$role_path"
    export GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT=true
    export GF_AUTH_GENERIC_OAUTH_ALLOW_ASSIGN_GRAFANA_ADMIN=false
    export GF_AUTH_GENERIC_OAUTH_USE_PKCE=true
    log "Keycloak login enabled for $OAUTH_CLIENT_ID (admin groups: ${GRAFANA_ADMIN_GROUPS:-none}, viewer groups: ${GRAFANA_VIEWER_GROUPS:-none})"
  else
    log "warning: could not read the OpenID discovery document; Grafana has the admin login only"
  fi
else
  log "warning: no OAuth secret; Grafana has the admin login only"
fi
unset OAUTH_CLIENT_SECRET
exec /run.sh "$@"
