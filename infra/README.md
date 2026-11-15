# STRATO HA infrastructure

AWS CDK apps for the tiered STRATO deployment. Each directory is an
independent CDK app with its own `package.json`, context contract and README.

> **This repo cannot synth on its own.** It needs a `strato-platform` checkout
> beside it at `../strato-platform`, or at the path in `STRATO_PLATFORM_DIR`.
> See [The strato-platform checkout](#the-strato-platform-checkout).

| App | Stacks | What it owns |
| --- | --- | --- |
| `data-plane` | `ha-<env>-data-postgres` | VPC, Aurora Postgres cluster |
| `core-cell` | `ha-<env>-cell-<cell>-{network,host}` | One EC2 core node (consensus, VM, indexer) |
| `api-tier` | `ha-<env>-api-{network,tier,frontdoor}` | ECS API tier and the CloudFront front door |
| `app-tier` | `ha-<env>-app-{network,tier,ui,history}` | ECS app tier |
| `observability` | `ha-<env>-obs-{core,alarms,grafana}` | Dashboards, alarms, canaries, collector configs |

Each app: `cd <app> && npm ci`, then `npx cdk deploy` with the context values
its README lists.

## Naming

Every AWS name a deployment creates starts with `ha-<envName>`: the stacks,
and through them the names CloudFormation generates (roles, security groups,
buckets, ECS services), plus every explicitly named resource (load balancers,
target groups, ECS clusters and task families, the Aurora cluster,
CloudFront functions and origin access controls, the cell's launch template)
and the secrets, SSM parameters and log groups under `ha-<envName>/...`.
Every taggable resource also carries
the tags `Deployment=ha-<envName>` and `ManagedBy=ha-infra`, which reach what
has no name (subnets, EBS volumes, KMS keys) and filter cost reports.
`lib/naming.ts` in each app holds the rule; `envName` is 2 to 16 lowercase
letters, digits or hyphens, so load balancer and target group names stay
within their 32 characters.

The `tiered` environment predates this naming (`Strato*-tiered-*` stacks,
`strato-*-tiered` resources) and is deployed only from the `tiered` branch,
which keeps the code it was created with; deploying it from this branch would
create a second set of resources beside it.

## Deploy order

`data-plane`, `core-cell` (the cells' load balancer, `ha-<env>-core-nlb`,
then the cells), `api-tier` (Network and Tier), the front door
(`ha-<env>-api-frontdoor`) **and its DNS record**, `app-tier`, then
`observability`.

- The front door and its DNS record must exist before the app tier deploys.
  The app backend blocks until `<nodeUrl>/strato-api/eth/v1.2/metadata`
  answers `isSynced: true`, and cannot tell an unresolvable name from a lagging
  node: the service never turns healthy and CloudFormation rolls back after
  about three hours.
- An app tier stack that rolls back takes its ALB with it. Re-point the front
  door's `appOriginDomainName` at the new ALB from the stack output afterwards.

## testnet-app: built and updated nightly

`testnet-app` (`ha-testnet-app-*`, the replacement for app.testnet.strato.nexus)
is described by `environments/testnet-app.env` and deployed by
`scripts/ha.sh`, which `Jenkinsfile.testnet` runs every night. The script
reads whatever a target needs from the stacks already deployed (the VPC,
Aurora endpoints, security groups, load balancer and instance names), so the
same run builds the environment from nothing and updates it:

1. The image set is what strato-platform's autobuild published for the
   `STRATO_BRANCH` commit checked out (default `develop`), under
   `ghcr.io/strato-net/strato-platform/<image>:<VERSION>-<commit>-<hash>`;
   the packages are public, so nothing logs in anywhere, and a commit not
   published yet fails the run before it deploys. strato-platform's
   `bin/strato-*`, `core-cell/bootstrap/strato-cell-upgrade` and
   `strato-cell-health` go to `NODE_SCRIPTS_S3`.
2. `data-plane` and `obs-core`.
3. `core-nlb`: one internal load balancer in front of the cells, with the
   target groups a cell's instance registers in. Port 8600 hands a
   transaction batch to one healthy cell (the cell's own health check on 8601
   decides); port 9090 is the first cell's Prometheus, for apex; the Grafana
   target group is for the API tier's load balancer.
4. Every cell's stack is deployed (`cells deploy`). A cell is one instance in
   an Auto Scaling group; a missing cell is created, one at a time, from the
   latest snapshot, and the run waits until it follows the chain. An instance
   asks the cluster at its first boot what it is: on an empty cluster it
   loads the snapshot's eth and cirrus into it and starts as the writer,
   otherwise it leaves them alone and starts as a standby. For an existing
   cell the deploy only brings its launch template up to date, which is what
   its next instance boots; the running instance is not touched. The cell
   running Grafana joins the Grafana target group once the API tier's load
   balancer forwards to it, so on a new environment from the second run on.
5. Existing cells are upgraded in place through SSM (`cells upgrade`):
   standbys first, then the lease holder, whose lease an upgraded standby
   takes while it restarts. Each cell gets the new image's binaries and the
   new node scripts and must follow the chain again before the next one is
   touched. Its node directory and docker-compose.yml stay as they were set
   up, so a change to the node's containers needs a rebuilt cell. A cell is
   drained before its node stops (its health check answers 503 for 30 s),
   and the upgrade reinstalls its health endpoint and watchdog. The image a
   cell came back on is recorded (SSM `/ha-testnet-app/core/strato-image`),
   and a new instance of any cell installs that one.
6. `api-tier`, given the load balancer's name as its ingress
   (`http://<core>:8600`) and Prometheus host and admitted on its security
   group (`coreLoadBalancerSecurityGroupId`); then `app-tier`, the front door
   (with freshly built app UI and SMD) and `obs-alarms`, then smoke checks through CloudFront by name, and the
   image set and both commits are recorded (`/ha-testnet-app/deploy/*`).
   A run with neither repo changed since does nothing.

Restarting the cells on the version they run is a pipeline run with
`CELL_ACTION=restart` (and `CELL=a` or `b` for one of them), or
`scripts/ha.sh testnet-app cells restart [<id>]`: each cell is drained,
restarted and back on the chain before the next, standbys first.

Each cell also restarts itself. The node stops whole when any one of its
processes exits (convoke), while systemd goes on reporting `strato-cell`
active, so nothing else brings it back. `strato-cell-watchdog` restarts the
node in place once it has been unhealthy for 2 minutes, at most once every 30
minutes, and only after the node has followed the chain since the watchdog
started (a bootstrap or an upgrade's catch-up is left alone). Each restart is
counted in CloudWatch (`STRATO/Cell` `WatchdogRestart`). When the node is
still not following the chain 10 minutes after such a restart, the watchdog
hands the instance back to its Auto Scaling group (`WatchdogReplace`), which
builds the cell again from the latest snapshot: on the cell's Elastic IP, as
a standby, registered with the load balancer. It does so only while another
cell is healthy behind the load balancer (with none, the fault is likely the
network's) and never in an instance's first 24 hours, so a build that cannot
sync is restarted, not rebuilt over and over. `CELL_ACTION=replace` with
`CELL=a` or `b`, or `scripts/ha.sh testnet-app cells replace <id>`, does the
same by hand, for any cell but the only healthy one; the old instance's
volumes go with it. It is also how a first cell whose load of the cluster
failed is started over: its bootstrap stops rather than run a node on
half-loaded databases, and the instance that replaces it loads them again. Healthy means every
core process answers and the node is within 5 blocks of the network's best
block (`strato-cell-upgrade --check`, the check the pipeline waits on);
`strato-cell-health` answers the same over HTTP on port 8601.

By hand, from a workstation with AWS credentials:

```sh
scripts/ha.sh testnet-app context api-tier
scripts/ha.sh testnet-app cdk api-tier diff
scripts/ha.sh testnet-app cells lease
scripts/ha.sh testnet-app cells restart b
aws ssm start-session --target "$(scripts/ha.sh testnet-app cells instance a)"
```

Before the first run:

- Secrets Manager: `ha-testnet-app/oauth`, the node's Keycloak client as JSON
  `{discoveryUrl, clientId, clientSecret}` with
  `https://app.testnet.strato.nexus/*` among its redirect and post-logout
  URIs; optionally `ha-testnet-app/app/backend`, the app backend's keys.
- Jenkins: a username/password credential
  `ha-deployer.example` holding the access key of an IAM
  user of the same name with `environments/testnet-app-deployer-policy.json`:
  the account's CDK bootstrap roles (`cdk-hnb659fds-*`), push to the
  `strato/*` ECR repositories, `NODE_SCRIPTS_S3`, SSM parameters under
  `/ha-testnet-app/`, `AWS-RunShellScript` on instances tagged
  `Deployment=ha-testnet-app`, and describing the deployment's stacks,
  secrets and load balancers. What CloudFormation may create is bounded by
  the bootstrap's execution role, not by this policy.
- After the first run, point `app.testnet.strato.nexus` (Cloudflare) at the
  front door: a CNAME to the `ha-testnet-app-api-frontdoor` stack's
  `DistributionDomainName`. Until then the app tier's backend talks to
  whatever that name resolves to.

## Known gaps (TODO)

- **apex follows the writer** (raise with Dustin; strato-platform and the
  api-tier app). The API tier's apex reads one Prometheus, `prometheusHost`,
  which `scripts/ha.sh` sets to the first cell, so the node health and
  "stalled" readings are that cell's view whoever holds the writer lease:
  after a failover they describe a standby, and with the first cell down they
  are unknown while the chain carries on. Every cell now publishes its
  Prometheus on its private address (`exposePrometheus`); apex needs to read
  the lease holder's (or all of them), and the core tier's load balancer to
  carry every cell's Prometheus, not only the first one's.
- **Managed Prometheus**, when there is a reason to pay for it. Without it
  (`managedPrometheus=false`, as in `testnet-app`) the per-tier dashboard's
  edge panels, its ECS sidecar panel and the infrastructure map's requests per
  tier stay empty: the ECS tasks' nginx metrics only reach a workspace, and
  Grafana on the first cell reads that cell's Prometheus alone.

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
2026-10-09), and is deployed from the `tiered` branch (see Naming), which
needs this change merged for the rollout: its cells run a Kafka build and its API tier submits through
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

Some resources outlive their stack on purpose: the Aurora cluster (RETAIN
plus deletion protection) and the front-door S3 buckets. Clean up retained
resources before deleting the stack that owns them. A cell's instance and
volumes go with its stack (its Auto Scaling group); delete the cells before
`ha-<env>-core-nlb`, whose target groups they are registered in.

## Context drift

`cdk.context.json` caches account lookups and the per-deployment values are
passed with `-c`. Deploying against a live environment with different context
values changes what is deployed, so run `npx cdk diff` first and expect it to
be empty.
