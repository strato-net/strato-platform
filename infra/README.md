# STRATO HA infrastructure

AWS CDK apps for the tiered STRATO deployment. Each directory is an
independent CDK app with its own `package.json`, context contract and README.

> **This repo cannot synth on its own.** It needs a `strato-platform` checkout
> beside it at `../strato-platform`, or at the path in `STRATO_PLATFORM_DIR`.
> See [The strato-platform checkout](#the-strato-platform-checkout).

| App | Stacks | What it owns |
| --- | --- | --- |
| `data-plane` | `StratoData-<env>-*` | VPC, Aurora Postgres cluster |
| `core-cell` | `StratoCell-<env>-<cell>-{Network,Host}` | One EC2 core node (consensus, VM, indexer) |
| `api-tier` | `StratoApi-<env>-{Network,Tier,FrontDoor}` | ECS API tier and the CloudFront front door |
| `app-tier` | `StratoApp-<env>-{Network,Tier}` | ECS app tier |
| `observability` | see its README | Dashboards, alarms, canaries, collector configs |

Each app: `cd <app> && npm ci`, then `npx cdk deploy` with the context values
its README lists.

## Deploy order

`data-plane`, `core-cell`, `api-tier` (Network and Tier), the front door
(`StratoApi-<env>-FrontDoor`) **and its DNS record**, `app-tier`, then
`observability`.

- The front door and its DNS record must exist before the app tier deploys.
  The app backend blocks until `<nodeUrl>/strato-api/eth/v1.2/metadata`
  answers `isSynced: true`, and cannot tell an unresolvable name from a lagging
  node: the service never turns healthy and CloudFormation rolls back after
  about three hours.
- An app tier stack that rolls back takes its ALB with it. Re-point the front
  door's `appOriginDomainName` at the new ALB from the stack output afterwards.

## Environments

`environments/<env>.sh` records the context a live environment was deployed
with and runs `cdk` with it:

```sh
export STRATO_PLATFORM_DIR=~/src/strato-platform   # if not at ../strato-platform
environments/tiered.sh api-tier diff --no-change-set
environments/tiered.sh front-door diff --no-change-set StratoApi-tiered-FrontDoor
```

The environment runs two core cells so that either can be lost or rebuilt
without an outage: `cell-a` (us-east-1a) and `cell-b` (us-east-1b), each a
full follower of the chain with its own embedded event log (JLog), sharing
the Aurora cluster.

- **Writes to Aurora** belong to whichever cell holds the writer lease. Both
  run `strato-lease-watch` (`autoPromote`), which takes the lease after about
  a minute of silence from its holder; every claim is counted in CloudWatch
  (`STRATO/Cell` `WriterLeaseClaimed`). A restarted cell logs "standby" at
  startup even while it holds the lease: read the lease
  (`strato-promote --status`), not that line. So "writer" in
  `environments/tiered.sh` only says which cell claims the lease when both
  start cold; the lease has moved between the cells since, and either may
  hold it.
- **Transactions from the API tier** are posted to every cell's ingress
  (`strato-ingest` on port 8600; the cells are listed in the API tier's
  `ingressUrls`), so both mempools hold every batch and a standby promoted
  later already has what the writer had. A submit succeeds once one cell has
  accepted it: a cell that is down costs nothing but its own timeout, and
  when it returns its sequencer catches up from the other cell's gossip.
  Each cell admits the tier's task security group on 8600
  (`clientSecurityGroupIds`); there is no load balancer in between.
- **Reads that need a VM** never reach a cell. Each API task runs vm-query
  over the SQL mirror and the copies share theirs through ECS Service Connect
  (`vm-query:8546`); what the mirror cannot answer (a non-latest block tag,
  `eth_getProof`, a block replay) is an error from the tier.

Adding a cell: deploy it with `clientSecurityGroupIds` naming the API tier's
task security group, add `http://<PrivateDnsName>:8600` to `INGRESS_URLS` in
`environments/tiered.sh`, then deploy `api-tier`. Removing one is the same in
reverse.

The live environment is behind this code (the JLog and ingress change of
2026-10-09): its cells run a Kafka build and its API tier submits through
`StratoCell-tiered-Frontend`, the load balancer on the cells' Kafka port,
which is no longer in the `core-cell` app. The order that keeps submits
flowing: both cells take `clientSecurityGroupIds` (a security group change
only); each cell in turn, standby first, is rebuilt on a `scaling` image with
JLog and `strato-ingest` from a v2 snapshot, since the Kafka topics in the
node directory do not carry over; `CELL_B_PRIVATE_DNS` is recorded and
`api-tier` deployed, which moves submits to the ingress and adds Service
Connect (new resources, the service updates in place); then the load balancer
goes, by hand: `aws cloudformation delete-stack --stack-name
StratoCell-tiered-Frontend`, which also removes the rules it added to the
cells' security groups.

`tiered` is account 406773134706, us-east-1, serving
https://app2.testnet.example.invalid. As of 2026-09-18 every stack diffs clean
except `StratoCell-tiered-cell-a-Host`, whose template is behind the instance
in three known ways:

- the Grafana ingress rule on 3001 from 0.0.0.0/0 is still in the template but
  already gone from the live security group; `grafanaCidrs` is empty, so a
  deploy removes it from the template too;
- the `Bootstrap` and `NodeScripts` assets follow `cell-bootstrap.sh` here and
  `bin/` in strato-platform, both changed since the cell was deployed;
- the Grafana Keycloak login (`grafanaPublicUrl`, `grafanaAdminGroups`,
  `grafanaViewerGroups`) and the newer strato image were applied to the
  running instance by hand, because cloud-init does not run again.

All of these change UserData, so CDK reports the instance as "may be
replaced". For this cell that means rebuilding a synced node: read the diff
and never accept it casually.

`observability` runs in traces-only mode here (no IAM Identity Center for
Managed Grafana, so Grafana and Prometheus stay on the cell). Its two SNS
topics, `strato-tiered-pages` and `strato-tiered-warnings`, have no
subscribers yet: alarms change state but notify nobody until one is added.

## The strato-platform checkout

This code was split out of `strato-platform` (`infra/`), and three things are
still read from a checkout of it at synth time:

- `bin/strato-*`: shipped to every core cell as a stack asset (always needed by `core-cell`)
- `app/ui/dist`: only with `deployAppUi` / `deployUi`
- `smd-ui/dist`: only with `deploySmdUi`

The checkout is expected beside this repo at `../strato-platform`. Set
`STRATO_PLATFORM_DIR` to use another path. Paths like
`design-documents/...`, `app/ui` and `smd-ui` in the READMEs refer to that repo.

## Teardown

Several resources outlive their stack on purpose: the core cell's EC2
instance (DeletionPolicy Retain) and its data volume, the Aurora cluster
(RETAIN plus deletion protection) and the front-door S3 buckets. A plain
`delete-stack` leaves them running and then hangs on the cell security group.
Clean up retained resources before deleting the stack that owns them.

## Context drift

`cdk.context.json` caches account lookups and the per-deployment values are
passed with `-c`. Deploying against a live environment with different context
values changes what is deployed, so run `npx cdk diff` first and expect it to
be empty.
