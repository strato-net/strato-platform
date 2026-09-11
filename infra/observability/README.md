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
submits a no-op transaction every minute and records its time to inclusion.
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
