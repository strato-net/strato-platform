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

`observability` is not deployed in this account.

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
