# STRATO HA infrastructure

AWS CDK apps for the tiered STRATO deployment. Each directory is an
independent CDK app with its own `package.json`, context contract and README.

> **This repo cannot synth on its own.** It needs a `strato-platform` checkout
> beside it at `../strato-platform`, or at the path in `STRATO_PLATFORM_DIR`.
> See [The strato-platform checkout](#the-strato-platform-checkout).

| App | Stacks | What it owns |
| --- | --- | --- |
| `data-plane` | `StratoData-<env>-*` | VPC, Aurora Postgres cluster, message bus |
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
full follower of the chain with its own Kafka, sharing the Aurora cluster.

- **Writes to Aurora** belong to whichever cell holds the writer lease. Both
  run `strato-lease-watch` (`autoPromote`), which takes the lease after about
  a minute of silence from its holder; every claim is counted in CloudWatch
  (`STRATO/Cell` `WriterLeaseClaimed`). A restarted cell logs "standby" at
  startup even while it holds the lease: read the lease
  (`strato-promote --status`), not that line. So "writer" in
  `environments/tiered.sh` only says which cell claims the lease when both
  start cold; the lease has moved between the cells since, and either may
  hold it.
- **Transactions from the API tier** go to `StratoCell-tiered-Frontend`, an
  internal load balancer on the cells' Kafka port, sticky by source address
  and health-checked on each cell's sequencer. The API tier only produces,
  so it does not matter which cell a task lands on. Every cell must advertise
  the load balancer's name (`kafkaExternalHost`): the API's Kafka client
  reconnects to the advertised address, so a cell advertising itself would
  keep being chosen after it died. The client does not retry: when a cell
  fails, submits from the tasks pinned to it return 500 until the health
  check ejects it (10 s interval, 2 failures, so about 20 s), then succeed.
  The client also connects lazily, on the first submit, so on a quiet
  deployment the load balancer's flow metrics are zero: that is idleness,
  not a broken path. To test the path, make a Kafka metadata request through
  the load balancer from inside the VPC and check that the broker it names
  is the load balancer.

Rolling the load balancer out, or adding a cell to it: deploy `core-frontend`;
record its `DnsName` as `CORE_NLB` in `environments/tiered.sh`; on each cell,
standby first, apply the new advertised name (`strato-setup --regenerate
--kafkaExternalHost=<name>` and a restart, since cloud-init does not run
again); then deploy `api-tier`. A cell that already advertises the name sends
even clients that dial it directly through the load balancer, so the API tier
can be switched last.

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
