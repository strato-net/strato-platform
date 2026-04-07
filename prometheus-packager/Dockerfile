FROM prom/prometheus:v2.49.1

COPY strato_prometheus.yml /etc/prometheus/strato_prometheus.tpl.yml

COPY LICENSE NOTICE /prometheus/

USER root
RUN chown -R 1000:1000 /prometheus
USER 1000

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
