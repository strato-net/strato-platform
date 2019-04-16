FROM prom/prometheus:latest

COPY strato_prometheus.yml /etc/prometheus/strato_prometheus.yml
COPY consoles /usr/share/prometheus/strato_consoles
COPY console_libraries /usr/share/prometheus/strato_console_libraries

COPY LICENSE NOTICE /prometheus/

ENTRYPOINT ["/bin/prometheus"]
CMD        ["--config.file=/etc/prometheus/strato_prometheus.yml", \
            "--storage.tsdb.path=/prometheus", \
            "--web.console.libraries=/usr/share/prometheus/strato_console_libraries", \
            "--web.console.templates=/usr/share/prometheus/strato_consoles", \
            "--web.external-url=http://anything/prometheus", \
            "--web.route-prefix=/prometheus"]
