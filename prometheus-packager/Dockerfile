FROM prom/prometheus:v2.49.1

COPY strato_prometheus.yml /etc/prometheus/strato_prometheus.yml

COPY LICENSE NOTICE /prometheus/

ENTRYPOINT sed -i "s;__NODE_HOST_MARKER__;${NODE_HOST:-localhost};" /etc/prometheus/strato_prometheus.yml && \
           cat /etc/prometheus/strato_prometheus.yml && \
           /bin/prometheus \
                  --config.file=/etc/prometheus/strato_prometheus.yml \
                  --storage.tsdb.path=/prometheus \
                  --web.external-url=http://anything/prometheus \
                  --web.route-prefix=/prometheus
