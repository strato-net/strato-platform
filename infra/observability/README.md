# STRATO observability

CDK app for one environment's observability plane. See
`design-documents/observability.md` for what it watches and why.

```
npm install
npx cdk synth -c envName=testnet -c edgeUrl=https://app.testnet.example \
  -c auroraClusterIdentifier=ha-testnet-postgres \
  -c albFullNames=app/ha-testnet-api/abc,app/ha-testnet-app/def \
  -c cellGroupNames=ha-testnet-cell-a,ha-testnet-cell-b
npx cdk deploy --all
```

Two stacks: `ha-<env>-obs-core` (Managed Prometheus with rules and alert
routing, Managed Grafana, collector configs in SSM, collector IAM, the
synthetic edge check) and `ha-<env>-obs-alarms` (CloudWatch alarms on the
managed services; each group appears only when its identifier is passed).

With `-c canaryKeySecretName=ha-testnet/canary-key` the canary also
submits a no-op transaction every five minutes and records its time to inclusion.
Run `npm run canary` first (installs the signing libraries and copies the
handler from canary/src next to them; synth refuses otherwise), create the secret as JSON
`{"privateKey":"0x..."}`, and fund the address the canary logs on its first
run. See `design-documents/observability.md`.

After deploy:

1. Subscribe PagerDuty to the `PagesTopicArn` output and Slack to
   `WarningsTopicArn`.
2. Install the collectors: cells attach the `CellInstanceProfileName`
   instance profile and fetch `/ha-<env>/observability/otel-collector-cell`
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
`-c otelConfigParameterName=/ha-<env>/observability/otel-collector-cell`
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
variable `frontend_labels` names them (`E123ABC=SMD,E456DEF=App UI,E789GHI=Portal`).
A name with "app" or "SMD" in it is that UI; any other name is a frontend of
its own, drawn with its arrow to the API tier. Once any distribution is named,
unnamed ones are not drawn; with nothing named, every distribution is shown as
the app UI. The CloudWatch queries are account-wide, so the map picks the
deployment out by `$env`: load balancers and ECS task families named
`ha-<env>-<tier>` and the RDS instances of the `ha-<env>-data-postgres`
stack, which matters in an account that holds anything else. A distribution with no datapoints
in the time range is not drawn, and one named `-` is hidden: CloudWatch keeps
listing a deleted distribution's metrics for about two weeks. Its code lives in
`dashboards/src/tier-map.getOption.js`; `scripts/embed-tier-map.py` writes it
and the panel's queries into `dashboards/infrastructure-map.json`.

Without IAM Identity Center there is no Managed Grafana, and a core cell is
not the place for a web application: `-c grafanaService=true` runs Grafana as
a Fargate service (`ha-<env>-obs-grafana`) from the image in `grafana/`,
with the plugins and these dashboards inside it. It reads Managed Prometheus,
CloudWatch and X-Ray with its task role, logs people in through Keycloak
(`oauthSecretName`; the groups in `grafanaAdminGroups` and
`grafanaViewerGroups` are the whitelist, and it never falls back to anonymous
access), and is reached through a `/grafana*` rule it adds to an existing
load balancer's listener. It keeps no state: a new task is a whole Grafana.
Deploying it builds the image, so it needs Docker.

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
- Container Insights on the deployment's ECS cluster, `ha-<env>` (task and
  container boxes come from its performance log group).
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

## Known gaps on the metrics path

The scrape configs, the rules and the transaction canary have only run in
the first proof-out; `testnet-app` uses the traces-only configs. Before an
environment turns `managedPrometheus` on, or gives the canary a key:

- **Cell scrape targets.** `config/cell-otel-collector.yaml` scrapes
  `localhost`, but strato-sequencer, vm-runner, strato-p2p and slipstream
  bind their metrics to the node's `apiListenAddress` (the docker bridge on
  Linux), as `strato-cell-upgrade --check` knows. The targets have to be
  rendered with that address when the cell installs the config.
- **One `instance` per cell.** Every cell reports `instance=localhost:<port>`,
  so the tier map cannot tell cells apart or join them to their CloudWatch
  boxes. Each scrape needs the cell's own name as its instance.
- **Jobs that do not exist everywhere.** The cell config scrapes `core-api`,
  which a core cell does not run, and the one sidecar config shared by the
  API and app tiers scrapes `core-api`, `app-backend` and `history` on every
  task: each missing target is `up == 0`, and `ProcessDown` pages on
  `core-api`. The sidecar also scrapes nginx on port 80 (the API tier's nginx
  listens on `httpPort`, 8081 by default; the app tier's has no `/metrics`)
  and an app backend path that serves no metrics. The configs have to be per
  role.
- **`BlockAgeHigh`.** `strato_best_block_timestamp_seconds` is set by
  strato-indexer only when a block's `RanBlock` and `NewBestBlock` events
  arrive in one batch; split across batches the gauge goes stale and the
  alert pages on a healthy chain. The producer has to carry the timestamp
  across batches first.
- **`VmRunnerHeapHigh`** reads `strato_rts_live_bytes{process="vm-runner"}`,
  which process-monitor exports; no scrape job collects process-monitor yet.
- **Transaction canary.** With `canaryKeySecretName` the canary sends a
  legacy transfer of 1 wei at gas price zero. From the STRATO-gas fork a
  native-value transfer must be a type-2 envelope, so on such a network the
  step fails and the canary alarms. It has to sign a type-2 transfer with a
  fee before it is given a key.
