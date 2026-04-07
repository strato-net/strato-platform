#!/bin/sh
STRATO_HOSTNAME=$(grep 'apiHost:' /config/ethconf.yaml | awk '{print $2}' | tr -d '"')
cp /etc/prometheus/strato_prometheus.tpl.yml /tmp/strato_prometheus.yml
sed -i "s;__NODE_HOST_MARKER__;${NODE_HOST:-localhost};" /tmp/strato_prometheus.yml
sed -i "s;__STRATO_HOSTNAME__;${STRATO_HOSTNAME:-localhost};" /tmp/strato_prometheus.yml
cat /tmp/strato_prometheus.yml
exec /bin/prometheus \
    --config.file=/tmp/strato_prometheus.yml \
    --storage.tsdb.path=/prometheus \
    --web.external-url=http://anything/prometheus \
    --web.route-prefix=/prometheus
