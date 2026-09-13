# STRATO data plane on AWS

CDK app for Phase 2 of the tiered deployment: the shared Postgres cluster.

`StratoData-<env>-Postgres` is an Aurora PostgreSQL cluster (version 14 to
match the node's container) with one writer and, by default, two readers.
The core's indexer and slipstream write the writer endpoint; PostgREST, the
app backend and later the API tier read the reader endpoint. Master
credentials are generated into Secrets Manager under `strato/<env>/postgres`
(a JSON secret with `username` and `password`); nothing here prints them.

## Deploy

```sh
cd infra/data-plane && npm ci
npx cdk synth --strict -c envName=testnet -c vpcId=vpc-0123 \
  -c clientSecurityGroupIds=sg-node,sg-apptasks -c clientCidrs=10.0.0.0/16
npx cdk deploy -c ...   # same context
```

Outputs give the writer and reader endpoints. Moving a node onto the cluster
is `bin/strato-pg-migrate` (see `design-documents/postgres-migration.md`).

Not included on purpose: RDS Proxy. strato-api now holds one pool per
process, so connection counts are bounded by instance count; add a proxy in
front of the reader endpoint only if that stops being true.
