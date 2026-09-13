# STRATO observability

CDK app for one environment's observability plane. See
`design-documents/observability.md` for what it watches and why.

```
npm install
npx cdk synth -c envName=testnet -c edgeUrl=https://app.testnet.example \
  -c auroraClusterIdentifier=strato-testnet \
  -c albFullNames=app/strato-api-testnet/abc,app/strato-app-testnet/def \
  -c mskClusterName=strato-bus-testnet -c mskConsumerGroups=strato-ingest-core-a,history \
  -c cellInstanceIds=i-0123,i-0456
npx cdk deploy --all
```

Two stacks: `StratoObs-<env>-Core` (Managed Prometheus with rules and alert
routing, Managed Grafana, collector configs in SSM, collector IAM, the
synthetic edge check) and `StratoObs-<env>-Alarms` (CloudWatch alarms on the
managed services; each group appears only when its identifier is passed).

With `-c canaryKeySecretName=strato/testnet/canary-key` the canary also
submits a no-op transaction every five minutes and records its time to inclusion.
Run `npm run canary` first (installs the signing libraries and copies the
handler from canary/src next to them; synth refuses otherwise), create the secret as JSON
`{"privateKey":"0x..."}`, and fund the address the canary logs on its first
run. See `design-documents/observability.md`.

After deploy:

1. Subscribe PagerDuty to the `PagesTopicArn` output and Slack to
   `WarningsTopicArn`.
2. Install the collectors: cells attach the `CellInstanceProfileName`
   instance profile and fetch `/strato/<env>/observability/otel-collector-cell`
   and `.../cloudwatch-agent` from SSM; the api and app tier apps take
   `-c otelConfigParameterName=<EcsCollectorParameter> -c otelSidecarPolicyArn=<SidecarPolicyArn>`.
3. Open Grafana (`GrafanaUrl`), add the Prometheus, CloudWatch and X-Ray
   data sources, then `scripts/push-dashboards.sh` with a short-lived
   service-account token and the data source uids.

## Traces only (no Managed Prometheus or Managed Grafana)

`-c managedPrometheus=false -c managedGrafana=false` deploys just the
collector configs (OTLP in, X-Ray out), the sidecar policy and the cell
role. The api-tier and app-tier apps take the `EcsCollectorParameter` and
`SidecarPolicyArn` outputs as before; a cell given
`-c otelConfigParameterName=/strato/<env>/observability/otel-collector-cell`
runs the collector, exports its own processes' spans to it, and, with
`-c grafana=true`, provisions an X-Ray data source in the host's Grafana so
the infrastructure-map dashboard's service map reads straight from X-Ray.
Managed Grafana needs IAM Identity Center or SAML, which a proof-out account
usually lacks; this mode is how the map was first brought up.

## Tier map panel

The first panel of the infrastructure-map dashboard draws the deployment as
five columns (frontends, app tier, API tier, shared data plane, core cells)
with a box per running thing and arrows along the request path. The
frontends column holds the app UI and SMD wherever they are served: from S3
behind CloudFront (requests, bytes served, 4xx and 5xx error rates), or as a
container on a full-node cell (moved out of that cell's box). A frontend with
no CloudFront traffic in the time range shows as a dashed "not deployed" box.
CloudWatch names a distribution only by its id, so the hidden dashboard
variable `frontend_labels` names them (`E123ABC=SMD,E456DEF=App UI`); an
unnamed distribution is shown as the app UI. Its code lives in
`dashboards/src/tier-map.getOption.js`; `scripts/embed-tier-map.py` writes it
and the panel's queries into `dashboards/infrastructure-map.json`.

What it needs:

- The Business Charts panel plugin (`volkovlabs-echarts-panel`). Version 7
  requires Grafana 12.3; pin 6.6.0 on Grafana 11.
- The panel data source left as `-- Mixed --`. With a single panel data
  source Grafana sends every query to it and the Prometheus queries fail.
- A CloudWatch data source with read access to CloudWatch metrics and Logs
  Insights (the cell role gets `CloudWatchReadOnlyAccess` when
  `grafana=true`), plus a second CloudWatch data source bound to the
  `DS_CLOUDWATCH_LOGS` input for the ECS task query alone. Queries on the
  same data source share a request id, and the frontend cancels the Logs
  Insights StartQuery when the metric request goes out, which leaves the
  task boxes empty in the browser while server-side tests pass.
- Container Insights on the app and api ECS clusters (task and container
  boxes come from the performance log groups).
- On each cell, the `strato-cell-containers` timer from the cell bootstrap,
  which publishes a `STRATO/Cell` `ContainerUp` datapoint per container each
  minute (about $0.30 a month per container).

Sources per column: CloudFront `Requests`, ALB `RequestCount` and target
health, ECS Container Insights; Aurora `CPUUtilization` with
`AuroraReplicaLag` telling readers from the writer; the node Prometheus's
`up`, `strato_writer_lease_held` and `strato_best_block_number` plus the
cell's `ContainerUp` datapoints. A replaced ECS task drops off once its last
report is more than 100 seconds behind the newest report in its cluster
(about two minutes after it stops; Container Insights delivers two to three
minutes late, so an absolute cutoff cannot tell stopped tasks from live
ones). Replaced target groups and removed containers drop off after ten to
fifteen minutes.
