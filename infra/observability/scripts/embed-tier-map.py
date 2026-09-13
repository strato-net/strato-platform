#!/usr/bin/env python3
"""Embeds dashboards/src/tier-map.getOption.js into the tier-map panel of
dashboards/infrastructure-map.json (creating the panel at the top when it is
missing). Run after editing the JavaScript."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / "dashboards"
js = (root / "src" / "tier-map.getOption.js").read_text()
path = root / "infrastructure-map.json"
d = json.loads(path.read_text())
CW = {"type": "cloudwatch", "uid": "${DS_CLOUDWATCH}"}
PROM = {"type": "prometheus", "uid": "${DS_PROMETHEUS}"}
# The Logs Insights query needs a CloudWatch data source of its own: sharing
# one with the metric queries gives both requests the same request id, and
# Grafana's frontend cancels the in-flight Logs StartQuery when the metrics
# request goes out, so the ECS task boxes never appear.
CWL = {"type": "cloudwatch", "uid": "${DS_CLOUDWATCH_LOGS}"}
# Mixed: with a single panel data source Grafana sends every query to it.
MIXED = {"type": "datasource", "uid": "-- Mixed --"}
def cw_metric(ref, namespace, metric, dims, stat="Average", region="default"):
    return {"refId": ref, "datasource": CW, "queryMode": "Metrics", "metricQueryType": 0, "metricEditorMode": 0, "region": region,
            "namespace": namespace, "metricName": metric, "dimensions": dims, "statistic": stat,
            "period": "60", "matchExact": True, "id": "", "expression": "", "label": ""}
def prom(ref, expr):
    return {"refId": ref, "datasource": PROM, "expr": expr, "instant": True, "range": False, "legendFormat": "{{instance}} {{job}}"}
panel = {
    "id": 100, "type": "volkovlabs-echarts-panel", "title": "Tier map: frontends, app tier, API tier, shared data plane, core cells",
    "description": "One box per running thing: each frontend wherever it is served (S3 behind CloudFront, or a container on a cell), each load balancer, each ECS task (health and performance, a row per container), each Aurora instance, each core cell (a row per process and per container). Amber = writer, blue = reader, violet = edge, green/red = up/down, dashed grey = not deployed. Name CloudFront distributions with the hidden frontend_labels variable (E123ABC=SMD).",
    "gridPos": {"x": 0, "y": 0, "w": 24, "h": 28},
    "datasource": MIXED,
    "targets": [
        {"refId": "tasks", "datasource": CWL, "queryMode": "Logs", "region": "default", "id": "",
         "logGroupNames": ["/aws/ecs/containerinsights/strato-app-$env/performance", "/aws/ecs/containerinsights/strato-api-$env/performance"],
         "expression": "fields Type, ClusterName, TaskId, ContainerName, CpuUtilized, CpuReserved, MemoryUtilized, MemoryReserved, NetworkRxBytes, NetworkTxBytes, ContainerHealthStatus, ContainerKnownStatus, KnownStatus, CreatedAt, Timestamp | filter Type = \"Task\" or Type = \"Container\" | stats latest(CpuUtilized) as cpu, latest(CpuReserved) as cpuReserved, latest(MemoryUtilized) as mem, latest(MemoryReserved) as memReserved, latest(NetworkRxBytes) as rx, latest(NetworkTxBytes) as tx, latest(ContainerHealthStatus) as health, latest(ContainerKnownStatus) as containerStatus, latest(KnownStatus) as taskStatus, latest(CreatedAt) as created, max(Timestamp) as seen by Type, ClusterName, TaskId, ContainerName",
         "statsGroups": ["Type", "ClusterName", "TaskId", "ContainerName"]},
        cw_metric("alb", "AWS/ApplicationELB", "RequestCount", {"LoadBalancer": "*"}, "Sum"),
        cw_metric("healthy", "AWS/ApplicationELB", "HealthyHostCount", {"TargetGroup": "*", "LoadBalancer": "*"}),
        cw_metric("unhealthy", "AWS/ApplicationELB", "UnHealthyHostCount", {"TargetGroup": "*", "LoadBalancer": "*"}),
        cw_metric("cdn", "AWS/CloudFront", "Requests", {"DistributionId": "*", "Region": "Global"}, "Sum", "us-east-1"),
        cw_metric("cdnBytes", "AWS/CloudFront", "BytesDownloaded", {"DistributionId": "*", "Region": "Global"}, "Sum", "us-east-1"),
        cw_metric("cdn4xx", "AWS/CloudFront", "4xxErrorRate", {"DistributionId": "*", "Region": "Global"}, "Average", "us-east-1"),
        cw_metric("cdn5xx", "AWS/CloudFront", "5xxErrorRate", {"DistributionId": "*", "Region": "Global"}, "Average", "us-east-1"),
        cw_metric("rds", "AWS/RDS", "CPUUtilization", {"DBInstanceIdentifier": "*"}),
        cw_metric("lag", "AWS/RDS", "AuroraReplicaLag", {"DBInstanceIdentifier": "*"}),
        prom("procs", 'up{job=~"ethereum-discover|strato-p2p|strato-sequencer|vm-runner|strato-indexer|slipstream|strato-api|core-api|ethereum-jsonrpc|vm-query|strato-ingest",env="$env"}'),
        prom("lease", 'strato_writer_lease_held{env="$env"}'),
        prom("height", 'strato_best_block_number{env="$env"}'),
        cw_metric("containers", "STRATO/Cell", "ContainerUp", {"Cell": "*", "Container": "*"}, "Maximum"),
    ],
    "options": {"renderer": "canvas", "editorMode": "code", "editor": {"format": "auto", "height": 600}, "map": "none", "themeEditor": {"name": "default", "config": "{}"},
                "getOption": js},
}
existing = [i for i, p in enumerate(d["panels"]) if p.get("type") == "volkovlabs-echarts-panel"]
if existing:
    # Replace the whole panel (queries and code), keeping where it sits.
    old_h = d["panels"][existing[0]]["gridPos"]["h"]
    panel["gridPos"]["y"] = d["panels"][existing[0]]["gridPos"]["y"]
    d["panels"][existing[0]] = panel
    for p in d["panels"]:
        if p is not panel and p["gridPos"]["y"] >= panel["gridPos"]["y"] + old_h:
            p["gridPos"]["y"] += panel["gridPos"]["h"] - old_h
else:
    for p in d["panels"]:
        p["gridPos"]["y"] += panel["gridPos"]["h"]
    d["panels"].insert(0, panel)
templating = d.setdefault("templating", {}).setdefault("list", [])
if not any(v.get("name") == "frontend_labels" for v in templating):
    templating.append({"name": "frontend_labels", "label": "Frontend labels", "type": "textbox", "hide": 2, "query": "",
                       "current": {"text": "", "value": ""}, "options": [],
                       "description": "Names for the tier map's CloudFront distributions: <DistributionId>=<name>, comma separated (E123ABC=SMD). An unnamed distribution is shown as the App UI."})
inputs = d.setdefault("__inputs", [])
if not any(i.get("name") == "DS_CLOUDWATCH_LOGS" for i in inputs):
    inputs.append({"name": "DS_CLOUDWATCH_LOGS", "label": "CloudWatch Logs", "description": "A second CloudWatch data source, used only by the tier map's Logs Insights query", "type": "datasource", "pluginId": "cloudwatch", "pluginName": "CloudWatch"})
path.write_text(json.dumps(d, indent=2) + "\n")
print("embedded", len(js), "chars;", len(d["panels"]), "panels")
