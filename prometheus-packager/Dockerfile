FROM prom/prometheus:latest

COPY strato_prometheus.yml /etc/prometheus/strato_prometheus.yml

ENTRYPOINT ["/bin/prometheus"]
CMD        ["--config.file=/etc/prometheus/strato_prometheus.yml", \
            "--storage.tsdb.path=/prometheus", \
            "--web.console.libraries=/usr/share/prometheus/console_libraries", \
            "--web.console.templates=/usr/share/prometheus/consoles", \
            "--web.external-url=http://anything/prometheus", \
            "--web.route-prefix=/prometheus"]
