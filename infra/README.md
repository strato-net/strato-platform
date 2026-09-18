# STRATO HA infrastructure

AWS CDK apps for the tiered STRATO deployment. Each directory is an
independent CDK app with its own `package.json`, context contract and README.

| App | Stacks | What it owns |
| --- | --- | --- |
| `data-plane` | `StratoData-<env>-*` | VPC, Aurora Postgres cluster, message bus |
| `core-cell` | `StratoCell-<env>-<cell>-{Network,Host}` | One EC2 core node (consensus, VM, indexer) |
| `api-tier` | `StratoApi-<env>-{Network,Tier,FrontDoor}` | ECS API tier and the CloudFront front door |
| `app-tier` | `StratoApp-<env>-{Network,Tier}` | ECS app tier |
| `observability` | see its README | Dashboards, alarms, canaries, collector configs |

Deploy order for a fresh environment: `data-plane`, `core-cell`, `api-tier`,
`app-tier`, then `observability`. Each app: `cd <app> && npm ci`, then
`npx cdk deploy` with the context values its README lists.

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
