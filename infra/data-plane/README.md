# STRATO data plane on AWS

CDK app for Phase 2 of the tiered deployment: the shared Postgres cluster.

`ha-<env>-data-postgres` is an Aurora PostgreSQL cluster (version 14 to
match the node's container) with one writer and, by default, two readers.
The core's indexer and slipstream write the writer endpoint; PostgREST, the
app backend and later the API tier read the reader endpoint. Master
credentials are generated into Secrets Manager under `ha-<env>/postgres`
(a JSON secret with `username` and `password`); nothing here prints them.

Nothing connects as the master login but the step that creates the node's
own: `strato` (`-c nodeLogin`), whose password is generated under
`ha-<env>/postgres/node` (`-c nodeLoginSecretName`, the same JSON shape;
outputs `NodeLogin` and `NodeLoginSecretName`). Aurora itself knows nothing
of it: the first core cell to boot creates the role with the master secret
(`ensure_database_login` in `core-cell/bootstrap/cell-bootstrap.sh`), with
what the node's own Postgres image gives it: it creates and owns the
databases, no more. The cells, the API tier, the app tier and the history
service all connect with it. A login that exists is left as it is, so a
changed secret does not change the password. A cluster that was set up with
the master login is not converted: its databases and the cells' seed table
belong to `postgres`, its running cells keep the master login in their
node configuration, and the tiers would ask for a login it does not have.
Such an environment is built again from nothing, as testnet-app is for this
change. On PostgreSQL 15 and later the
login cannot create the cells' seed table (`strato_cluster_seed`, in the
`postgres` database's `public` schema); the cluster here is 14.

## Deploy

```sh
cd data-plane && npm ci
npx cdk synth --strict -c envName=testnet -c vpcId=vpc-0123 \
  -c clientSecurityGroupIds=sg-node,sg-apptasks -c clientCidrs=10.0.0.0/16
npx cdk deploy -c ...   # same context
```

Outputs give the writer and reader endpoints. Moving a node onto the cluster
is `bin/strato-pg-migrate` (see `design-documents/postgres-migration.md`).

Not included on purpose: RDS Proxy. strato-api now holds one pool per
process, so connection counts are bounded by instance count; add a proxy in
front of the reader endpoint only if that stops being true.
