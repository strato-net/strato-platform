# Grafana for a STRATO environment: the plugins the dashboards need, the
# dashboards themselves, and an entrypoint that writes the data sources and
# the Keycloak login from the task's environment. Built by the Grafana stack
# with this app's directory as the context.
FROM grafana/grafana-oss:11.2.0
USER root
RUN apk add --no-cache jq curl
# Business Charts draws the tier map; 7.x needs Grafana 12.3, 6.6 is the last
# line for 11.2. X-Ray holds the traces.
RUN grafana cli --pluginsDir /var/lib/grafana-plugins plugins install volkovlabs-echarts-panel 6.6.0 \
 && grafana cli --pluginsDir /var/lib/grafana-plugins plugins install grafana-x-ray-datasource \
 && chown -R 472:0 /var/lib/grafana-plugins
COPY dashboards/*.json /usr/share/strato/dashboards/
COPY grafana/entrypoint.sh /strato-entrypoint.sh
RUN chmod 0755 /strato-entrypoint.sh && install -d -o 472 -g 0 /etc/strato-grafana /var/lib/strato-dashboards
USER 472
ENV GF_PATHS_PLUGINS=/var/lib/grafana-plugins GF_PATHS_PROVISIONING=/etc/strato-grafana/provisioning
ENTRYPOINT ["/strato-entrypoint.sh"]
