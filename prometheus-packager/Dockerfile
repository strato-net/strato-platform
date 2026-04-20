FROM prom/prometheus:v2.49.1

COPY strato_prometheus.yml /etc/prometheus/strato_prometheus.tpl.yml

COPY LICENSE NOTICE /prometheus/

USER root
RUN mkdir -p /usr/local/bin && wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.44.6/yq_linux_amd64 && chmod +x /usr/local/bin/yq
RUN chown -R 1000:1000 /prometheus
USER 1000

COPY entrypoint.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
