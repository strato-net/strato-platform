#!/bin/sh
NODE_URL=$(yq '.urlConfig.nodeUrl' /config/ethconf.yaml)
STRATO_HOSTNAME=$(echo "$NODE_URL" | sed 's|https\?://\([^:/]*\).*|\1|')
NODE_HOST=$(echo "$NODE_URL" | sed 's|https\?://||')
cp /etc/prometheus/strato_prometheus.tpl.yml /tmp/strato_prometheus.yml
sed -i "s;__NODE_HOST_MARKER__;${NODE_HOST:-localhost};" /tmp/strato_prometheus.yml
sed -i "s;__STRATO_HOSTNAME__;${STRATO_HOSTNAME:-localhost};" /tmp/strato_prometheus.yml
# Drop scrape jobs for processes this node does not run. A core cell has no
# strato-api, apex or nginx (they are the API tier's), and no strato-ingest
# without a message bus, so without this their targets are DOWN forever: noise
# that hides a real outage and makes any `up == 0` alert page for nothing.
# strato-setup computes the list from the role and flags.
if [ -n "${PROMETHEUS_SKIP_JOBS:-}" ]; then
    awk -v skip="$PROMETHEUS_SKIP_JOBS" '
        BEGIN {
            n = split(skip, a, ",")
            for (i = 1; i <= n; i++) { gsub(/[^a-zA-Z0-9_-]/, "", a[i]); if (a[i] != "") drop[a[i]] = 1 }
        }
        /^[[:space:]]*-[[:space:]]*job_name:/ {
            name = $0
            sub(/.*job_name:/, "", name)
            gsub(/[^a-zA-Z0-9_-]/, "", name)
            skipping = (name in drop)
        }
        !skipping { print }
    ' /tmp/strato_prometheus.yml > /tmp/strato_prometheus.filtered.yml \
      && mv /tmp/strato_prometheus.filtered.yml /tmp/strato_prometheus.yml
    echo "prometheus: skipped scrape jobs: $PROMETHEUS_SKIP_JOBS"
fi
cat /tmp/strato_prometheus.yml
exec /bin/prometheus \
    --config.file=/tmp/strato_prometheus.yml \
    --storage.tsdb.path=/prometheus \
    --web.external-url=http://anything/prometheus \
    --web.route-prefix=/prometheus
