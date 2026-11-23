# STRATO HA infrastructure

AWS CDK apps for the high-availability STRATO deployment, and
`scripts/ha.sh`, which deploys one environment with them. Each directory is
an independent CDK app with its own `package.json`, context contract and
README.

The apps read a few things from the rest of this repository at synth time:
see [What the apps read from the repository](#what-the-apps-read-from-the-repository).

| App | Stacks | What it owns |
| --- | --- | --- |
| `data-plane` | `ha-<env>-data-postgres` | VPC, Aurora Postgres cluster |
| `core-cell` | `ha-<env>-cell-<cell>-{network,host}` | One EC2 core node (consensus, VM, indexer) |
| `api-tier` | `ha-<env>-api-{network,tier,frontdoor}` | ECS API tier and the CloudFront front door |
| `app-tier` | `ha-<env>-app-{network,tier,ui,history}` | ECS app tier |
| `observability` | `ha-<env>-obs-{core,alarms,grafana}` | Dashboards, alarms, canaries, collector configs |

Each app: `cd <app> && npm ci`, then `npx cdk deploy` with the context values
its README lists.

[TOPOLOGY.md](TOPOLOGY.md) draws one deployed environment: where each part
sits and which part can reach which. A change to the stacks, services, ports,
CloudFront paths or security-group rules updates it in the same change.

## Naming

Every AWS name a deployment creates starts with `ha-<envName>`: the stacks,
and through them the names CloudFormation generates (roles, security groups,
buckets, ECS services), plus every explicitly named resource (load balancers,
target groups, ECS clusters and task families, the Aurora cluster,
CloudFront functions and origin access controls, the cell's launch template)
and the secrets, SSM parameters and log groups under `ha-<envName>/...`.
Every taggable resource also carries
the tags `Deployment=ha-<envName>` and `ManagedBy=strato-platform/infra`, which reach what
has no name (subnets, EBS volumes, KMS keys) and filter cost reports.
`lib/naming.ts` in each app holds the rule; `envName` is 2 to 16 lowercase
letters, digits or hyphens, so load balancer and target group names stay
within their 32 characters.

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
- The front door in turn sends the app backend's paths to the app tier's ALB.
  So an environment's first front door is deployed without
  `appOriginDomainName` (those paths fall to the app UI), the hostname is
  pointed at it, the app tier is deployed, and the front door is deployed
  again with the app tier's ALB. `scripts/ha.sh <env> first-front-door` does
  the first of these only where there is no app tier stack (and creates a
  front door that is missing beside an app tier, with its paths), and
  `wait-hostname` holds the app tier back until the name leads to the front
  door and answers.
- The deployment has one ECS cluster, `ha-<env>`. The API tier stack
  creates it and the app tier's services join it by name (`-c clusterName`),
  so the app tier is destroyed before the API tier.
- An app tier stack that rolls back takes its ALB with it. Re-point the front
  door's `appOriginDomainName` at the new ALB from the stack output afterwards.
- A stack whose creation fails is rolled back and holds nothing; the next
  `scripts/ha.sh` deploy replaces it. Where such a stack has termination
  protection (a cell's host stack, the data plane), the script lifts it first,
  through the CDK deploy role: CloudFormation refuses to delete a protected
  stack, and the stack created in its place is protected again.

## Environments

An environment is one settings file, `<env>.env`: its name, region, network,
hostname, certificate, cells and sizes. `environments/example.env` lists
every setting `scripts/ha.sh` reads. A real environment's file is not kept in
this repository: put it in a directory of its own and name that directory in
`HA_ENV_DIR` (`HA_ENV_DIR=/path/to/environments scripts/ha.sh <env> ...`).
The pipeline that deploys an environment every night lives with its file.
`environments/deployer-policy.template.json` is the IAM policy of the
identity such a pipeline runs as.

## testnet-app: built and updated nightly

`testnet-app` (`ha-testnet-app-*`, the replacement for app.testnet.strato.nexus)
is described by its environment file, `testnet-app.env`, and deployed by
`scripts/ha.sh`, which a Jenkins pipeline runs every night. The script
reads whatever a target needs from the stacks already deployed (the VPC,
Aurora endpoints, security groups, load balancer and instance names), so the
same run builds the environment from nothing and updates it:

1. The image set is what this repository's autobuild published for the
   `STRATO_BRANCH` commit checked out, under
   `ghcr.io/strato-net/strato-platform/<image>:<VERSION>-<commit>-<hash>`
   (the node image under `strato:<VERSION>-<commit>`: a build regenerates
   tracked `.cabal` files, so its hash is not always the one a clean checkout
   computes). `STRATO_BRANCH` is a branch (default `develop`) or, to pin a
   version, one commit by its full id;
   the packages are public, so nothing logs in anywhere, and a commit not
   published yet fails the run before it deploys (`scripts/ha.sh testnet-app
   images` reads the names from the Makefile and checks each
   image). The repository's
   `bin/strato-*`, `core-cell/bootstrap/strato-cell-upgrade` and
   `strato-cell-health` go to the node scripts bucket of step 3.
2. `data-plane` and `obs-core`. The data plane also generates the password
   of the node's own database login (`strato`, secret
   `ha-testnet-app/postgres/node`); the first cell to boot creates that
   login on the cluster, and nothing else uses the master login.
3. `core-nlb`: one internal load balancer in front of the cells, with the
   target groups a cell's instance registers in. Port 8600 hands a
   transaction batch to one healthy cell (the cell's own health check on 8601
   decides); port 9090 is the first cell's Prometheus, for apex; the Grafana
   target group is for the API tier's load balancer. The same stack owns the
   node scripts bucket (`ha-testnet-app-node-scripts-<account>`, versioned):
   a cell installs what is under `node-scripts/` there as root, so the bucket
   is the environment's own and only this pipeline writes it.
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
   group (`coreLoadBalancerSecurityGroupId`). It creates the deployment's one
   ECS cluster, `ha-testnet-app`, which the app tier's services join. Both
   tiers' nginx are given the VPC's range and CloudFront's origin-facing
   ranges (read from the managed prefix list on every run) as trusted
   proxies, so they see the client's address. The app backend is pointed at
   the partner referrals service the environment file names
   (`PARTNER_REFERRALS_URL`, `PARTNER_INTERNAL_KEY_SECRET`), when it names
   one, with that service's internal key.
7. The hostname. The app backend starts only once
   `https://app.testnet.strato.nexus` answers as a synced node, so the run
   waits before the app tier until the name leads to this front door (its
   CNAME) and answers as one; a synced answer from anywhere else, such as a
   node the environment replaces, does not count. In an environment that has
   no app tier yet (the first run) it first deploys the front door without
   the app tier's paths, then waits up to 12 hours (`HOSTNAME_WAIT_MINUTES`)
   for the DNS record, which is set by hand; the build log names the
   distribution the record has to point at, every minute.
8. `app-tier`, the front door
   (with freshly built app UI and SMD; the app UI's `config.js` carries the
   environment file's `POSTHOG_KEY`, `POSTHOG_HOST` and `GOOGLE_ANALYTICS_ID`,
   when it names them) and `obs-alarms`, then smoke checks through CloudFront by name, and the
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

`scripts/ha.sh` checks the environment file before it asks anything
of AWS: a setting that is missing, misspelt or of the wrong shape stops every
command at once. A command that needs the image set takes it from the
environment (what `images` printed) and never falls back to the set last
deployed by itself; by hand, between deployments, name that set with
`HA_IMAGES=recorded`.

By hand, from a workstation with AWS credentials:

```sh
export HA_IMAGES=recorded
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
- Jenkins: a username/password credential holding the access key of an IAM
  user with the policy of `environments/deployer-policy.template.json`:
  the account's CDK bootstrap roles (`cdk-hnb659fds-*`), push to the
  `strato/*` ECR repositories, the node scripts bucket, SSM parameters under
  `/ha-testnet-app/`, `AWS-RunShellScript` on instances tagged
  `Deployment=ha-testnet-app`, and describing the deployment's stacks,
  secrets and load balancers. What CloudFormation may create is bounded by
  the bootstrap's execution role, not by this policy.

During the first run, when the build log starts asking for it (the
`Hostname` stage): point `app.testnet.strato.nexus` (Cloudflare, DNS only) at
the front door, a CNAME to the `ha-testnet-app-api-frontdoor` stack's
`DistributionDomainName`. The run goes on by itself once the name answers.

## Known gaps (TODO)

- **apex follows the writer** (the apex service and the api-tier app). The
  API tier's apex reads one Prometheus, `prometheusHost`,
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

## Cells and the writer lease

The environment runs two core cells so that either can be lost or rebuilt
without an outage: `cell-a` (us-east-1a) and `cell-b` (us-east-1b), each a
full follower of the chain with its own embedded event log (JLog), sharing
the Aurora cluster.

- **Writes to Aurora** belong to whichever cell holds the writer lease. Both
  run `strato-lease-watch` (`autoPromote`), which takes the lease after about
  a minute of silence from its holder; every claim is counted in CloudWatch
  (`STRATO/Cell` `WriterLeaseClaimed`). A restarted cell logs "standby" at
  startup even while it holds the lease: read the lease
  (`strato-promote --status`, or `scripts/ha.sh <env> cells lease`), not that
  line. The first cell in `CELLS` is the writer only when the environment is
  created; the lease moves between the cells afterwards, and either may hold
  it.
- **Reads that need a VM** never reach a cell. Each API task runs vm-query
  over the SQL mirror and the copies share theirs through ECS Service Connect
  (`vm-query:8546`); what the mirror cannot answer (a non-latest block tag,
  `eth_getProof`, a block replay) is an error from the tier.

## What the apps read from the repository

Three things outside `infra/` are read at synth time:

- `bin/strato-*`: shipped to every core cell as a stack asset (always needed by `core-cell`)
- `app/ui/dist`: only with `deployAppUi` / `deployUi`
- `smd-ui/dist`: only with `deploySmdUi`

They are taken from the repository this directory is in. Set
`STRATO_PLATFORM_DIR` to read them from another checkout, for example to
deploy the node scripts and UI of one commit with the CDK apps of another.

## Teardown

Some resources outlive their stack on purpose: the Aurora cluster (RETAIN
plus deletion protection) and the front-door S3 buckets. Clean up retained
resources before deleting the stack that owns them. A cell's instance and
volumes go with its stack (its Auto Scaling group); delete the cells before
`ha-<env>-core-nlb`, whose target groups they are registered in.

## Context drift

`cdk.context.json` caches account lookups (it is not tracked: it names one
account's resources) and the per-deployment values are
passed with `-c`. Deploying against a live environment with different context
values changes what is deployed, so run `npx cdk diff` first and expect it to
be empty.
