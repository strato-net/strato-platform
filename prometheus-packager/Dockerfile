FROM prom/prometheus:v2.49.1

COPY strato_prometheus.yml /etc/prometheus/strato_prometheus.tpl.yml

COPY LICENSE NOTICE /prometheus/

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
