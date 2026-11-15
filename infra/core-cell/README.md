# STRATO core cell on AWS

CDK app for one core cell of the tiered deployment: an EC2 host running the
node's consensus, VM and indexer processes under convoke, with Redis and
Prometheus in containers beside them (the event log, JLog, is embedded in the
processes), against the shared Aurora cluster from `data-plane`. It is the
same layout the testnet hosts run by hand today, built from nothing at boot
and supervised by systemd. The API tier reaches a cell on one port: 8600,
where `strato-ingest` takes its transaction batches.

The host is the one instance of an Auto Scaling group. When that instance is
lost, or handed back by the cell's watchdog or by `scripts/ha.sh cells
replace`, the group launches another from the launch template: it takes the
cell's Elastic IP, restores the latest snapshot onto new volumes and
registers in the core tier's target groups. Deploying the stack never
replaces a running instance; a changed launch template is what the next one
boots.

A cell is a **follower** by default: `--writer=false` (it indexes into the
cluster only when it holds the writer lease) and `--validatorBehavior=false`
(it never votes). Pass `-c writer=true` for the writer core, or
`-c seedEmptyCluster=true` on every cell and let each instance's first boot
decide: writer on an empty cluster, standby otherwise. Promotion of a
running follower is `strato-promote` on the host; see
`design-documents/standby-core.md`.

## How the host is built

Ubuntu 24.04 (the strato image's base, so the image's binaries run on the
host unchanged). At first boot the instance, with its own role:

1. installs docker, the binaries' runtime libraries and the CloudWatch agent;
2. formats and mounts the data volume at `/var/lib/strato`;
3. pulls the strato image from its registry and copies its `/usr/local/bin` onto the
   host, plus strato-platform's `bin/strato-*` scripts (shipped as a stack asset);
4. reads the Aurora master secret and runs `strato-up --role=core ...` once,
   which sets the node directory up (`/var/lib/strato/node`), restores a
   snapshot when one was given, and starts convoke;
5. hands the node to `strato-cell.service` (systemd: `strato-up` on start,
   `strato-down` on stop, enabled at boot);
6. starts the ADOT collector and the CloudWatch agent when the observability
   app's configs are named.

Before all that a public cell attaches its Elastic IP to itself. With
`stratoImageParameter`, step 3 installs the image recorded there; with
`seedEmptyCluster`, step 4 first asks the cluster whether this instance loads
the snapshot's databases and starts as the writer, or joins as a standby.

The bootstrap log is `/var/log/strato-cell-bootstrap.log`; the node's logs
are under `/var/lib/strato/node/logs`. `aws ssm start-session --target
<instance>` gets a shell without SSH.

## Before deploying

1. The `strato` image, and the `prometheus` image beside it under the same
   registry prefix (the generated compose pulls it with `--repoUrl`).
   strato-platform's autobuild publishes them for every commit it builds
   (develop, branches, release tags) as
   `ghcr.io/strato-net/strato-platform/<image>:<VERSION>-<commit>-<hash>`,
   strato also as `strato:<VERSION>-<commit>` and, for a release tag, as
   `strato:<tag>`. The packages are public: the host logs in nowhere (an
   ECR URI still works, through the instance role).
2. The Aurora cluster (`data-plane`), allowing this stack's security
   group (output `SecurityGroupId`) on 5432, and its master secret
   `ha-<env>/postgres`.
3. The network's VPC id when the cell must peer with existing validators
   over private addresses (`-c vpcId`); otherwise the app creates a VPC.
4. Optionally the observability app's outputs: the cell collector and
   CloudWatch agent SSM parameter names and the Prometheus workspace ARN.

## Deploy

```sh
npm install
npx cdk synth --strict \
  -c envName=testnet -c cellId=core-b -c vpcId=vpc-0123 \
  -c stratoImage=ghcr.io/strato-net/strato-platform/strato:19.5-d13a271-4d78dd856e44 \
  -c postgresWriterHost=strato-testnet.cluster-xyz.us-east-1.rds.amazonaws.com \
  -c postgresReaderHost=strato-testnet.cluster-ro-xyz.us-east-1.rds.amazonaws.com \
  -c network=upquark \
  -c clientSecurityGroupIds=sg-apitier \
  -c sshSourceSecurityGroupId=sg-bastion \
  -c otelConfigParameterName=/strato/testnet/observability/otel-collector-cell \
  -c cloudWatchAgentParameterName=/strato/testnet/observability/cloudwatch-agent \
  -c prometheusWorkspaceArn=arn:aws:aps:us-east-1:123456789012:workspace/ws-...
npx cdk deploy --all -c ...   # same context
```

Then (unless `postgresSecurityGroupId` was given) allow the output
`SecurityGroupId` on the Aurora security group. The cell is behind the core
tier's load balancer (below) when it was given that stack's outputs.

## The core tier's load balancer

`-c coreNlb=true` deploys, instead of a cell, the environment's internal
Network Load Balancer in front of its cells (`ha-<env>-core-nlb`,
`lib/core-nlb-stack.ts`), so the API tier addresses the core tier by one name
and a rebuilt cell changes nothing there. Deploy it before the cells: it
knows none of them, and each cell registers its instance in its target
groups.

```sh
npx cdk deploy -c coreNlb=true -c envName=testnet -c vpcId=vpc-0123
```

- **8600**, the transaction ingress, goes to every cell in the ingress
  target group. A batch
  reaches one healthy cell, which gossips it to the network and to the other
  cells. Healthy is the cell's `strato-cell-health` on 8601, checked every
  10 s: a cell whose node is down, behind the chain or draining for a restart
  is out after two failures. With every cell unhealthy the load balancer
  sends to all of them.
- **9090** is one cell's Prometheus alone, the cell given the Prometheus
  target group (with `exposePrometheus`): apex's stall check compares one
  node's counters over time, so it must not alternate between cells.
- The **Grafana** target group has no listener here: the API tier's load
  balancer forwards `/grafana` to it, and the cell running Grafana registers
  in it.

Give its outputs to the cells: `SecurityGroupId` as
`coreLoadBalancerSecurityGroupId` (the cell admits the load balancer on its
ports) and `IngressTargetGroupArn` as `ingressTargetGroupArn` on every cell,
`PrometheusTargetGroupArn` and `GrafanaTargetGroupArn` on the one cell that
serves them. And to the api-tier app: `DnsName` as
`ingressUrls=http://<DnsName>:8600` and `prometheusHost=<DnsName>:9090`,
`SecurityGroupId` as `coreLoadBalancerSecurityGroupId`,
`GrafanaTargetGroupArn` as `grafanaTargetGroupArn`.

## Context

| key | default | meaning |
|---|---|---|
| `envName` | `testnet` | environment name, used in resource names and secret names |
| `cellId` | required | this core's name among the cores sharing the cluster (`--cellId`); the peer store is `peers_<cellId>` |
| `vpcId` | create one | the network's VPC |
| `subnetType` | `public` | `public` gives an Elastic IP peers can dial; `private` dials out only |
| `instanceType` | `m6i.xlarge` | |
| `rootVolumeGiB` / `dataVolumeGiB` | 40 / 200 | the data volume holds the node directory and survives the instance |
| `amiParameter` | Canonical Ubuntu 24.04 | SSM public parameter naming the AMI |
| `keyPairName` | none | SSH key; Session Manager works without one |
| `stratoImage` | required | registry URI with tag: `ghcr.io/strato-net/strato-platform/strato:<VERSION>-<commit>-<hash>` |
| `repoUrl` | registry prefix of `stratoImage` | `--repoUrl` for the generated compose |
| `extraBinariesS3` | none | `s3://bucket/prefix/` of extra binaries installed into `/usr/local/bin` (for an image that lacks one) |
| `network` | `upquark` | `--network`; carries the bootnodes and chain id |
| `postgresWriterHost` / `postgresReaderHost` / `postgresPort` / `postgresUser` | required / writer / 5432 / postgres | Aurora endpoints |
| `postgresSecretName` | `ha-<env>/postgres` | master secret, JSON with a `password` field |
| `postgresSecurityGroupId` | none | the cluster's security group; the stack opens it to the cell on the Postgres port |
| `role` | `core` | `node` also runs the app on this host (nginx on httpPort/443, app UI and backend, SMD, apex, PostgREST); needs those images under `repoUrl` |
| `bundledApp` | `true` | with role node: run app-ui and app-backend on this host; `false` when the app tier serves the app (the node's root redirects to `appUrl`) |
| `appUrl` | none | the app tier's public URL, with `bundledApp=false` |
| `bundledSmd` | `true` | with role node: run the SMD on this host; `false` when it is served from S3 behind CloudFront (the node's `/smd` redirects to `smdUrl`) |
| `smdUrl` | none | the SMD deployment's public URL, with `bundledSmd=false` |
| `bundledPostgrest` | `true` | with role node: run PostgREST (the Cirrus API at `/cirrus`) on this host; `false` when the API tier serves Cirrus (the node's `/cirrus` answers 502) |
| `localAuth` | `false` | with role node: local OpenID provider instead of Keycloak; admin `admin`, password in `/etc/strato/local-auth-admin-password` on the host |
| `oauthSecretName` | none | without localAuth: Secrets Manager secret, JSON `{discoveryUrl, clientId, clientSecret}`, holding the node's Keycloak client (confidential, service accounts enabled, the node's URL among its redirect URIs). The host writes it as strato-login would; strato-setup then creates the node key in the shared vault (`--vaultUrl`, default vault.blockapps.net) under that client |
| `frontendLabels` | none | with `grafana`: names for the tier map's CloudFront distributions (`E123ABC=SMD,E456DEF=App UI,E789GHI=Portal`); once set, unnamed distributions are not drawn |
| `ethconfParameterName` | none | SSM parameter this cell publishes its generated `ethconf.yaml` to (base64, SecureString, rewritten each boot): the API tier reads it as its node config (`-c ethconfParameterName=` there). Set it on the writer cell only |
| `exposePrometheus` | `false` | publish the node's Prometheus on the cell's private IP, port 9090 (a socat container), for the API tier's apex: pass `-c prometheusHost=<core load balancer DnsName>:9090` there (`<PrivateDnsName>:9090` without a load balancer) |
| `grafana` | `false` | Grafana container on port 3001 (anonymous viewer; admin password in `/etc/strato/grafana-admin-password`) over the node's Prometheus, with the repo's dashboards |
| `tlsHostname` / `letsEncryptEmail` | none | public hostname (an A record to the cell's Elastic IP): the host obtains a Let's Encrypt certificate for it over port 80, sets its hostname to it, and the node serves `https://<hostname>/` (the app URL, the OAuth issuer) |
| `webCidrs` | `0.0.0.0/0` | who may reach the app (`httpPort`, 443) |
| `grafanaCidrs` | none | who may reach Grafana (3001). Empty means no ingress rule: Grafana serves plain HTTP with anonymous viewer access, so it must not inherit the public `webCidrs`. Reach it with `aws ssm start-session --target <instance> --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["3001"],"localPortNumber":["3001"]}'`, or name your own networks here |
| `httpPort` | `8081` | the node's HTTP port; nginx publishes it (plain HTTP) and 443 |
| `peerStore` | `sqlite` | where the cell keeps peers and sync tasks (`--peerStore`): `sqlite` is a file in the node directory, so a database failover or maintenance no longer restarts ethereum-discover and strato-p2p; `postgres` keeps them in the cluster as a monolith does
| `peerDatabase` | none | per-cell peer store database on Postgres (`--peerDatabase`); only read with `peerStore: postgres`. strato-p2p keeps block reads on the eth database and peers on this one |
| `writer` | `false` | claim the writer lease at start |
| `seedEmptyCluster` | `false` | let the first boot decide `writer` and `snapshotSkipDatabases` from the cluster: with no `eth` database there, the cell claims the load (one row in `strato_cluster_seed`, in the cluster's `postgres` database), loads the snapshot's databases, starts as the writer and marks the row done; otherwise it leaves them alone and starts as a standby. An instance replacing one that never finished loading loads again; another cell arriving meanwhile stops. A replaced instance boots again, so this is the only safe way to name a "first cell" of a group. To load a cluster again after dropping its databases, drop that table too |
| `stratoImageParameter` | none | SSM parameter naming the image the environment's cells run (`scripts/ha.sh cells upgrade` writes it): a new instance installs that image when the parameter exists, `stratoImage` otherwise |
| `coreLoadBalancerSecurityGroupId` | none | the core tier's load balancer's security group: admitted on 8600, 8601 and, with `exposePrometheus`, 9090 |
| `ingressTargetGroupArn` / `prometheusTargetGroupArn` / `grafanaTargetGroupArn` | none | the core tier's target groups this cell's instance registers in; with the ingress group the watchdog may also have an instance it cannot revive replaced |
| `validatorBehavior` | `false` | vote in consensus |
| `vmQuery` | `false` | run vm-query on the cell |
| `snapshotSource` | none | `s3://bucket/key.tar.zst`, or a published timestamp / `latest` |
| `snapshotBucket` | `strato-snapshots` | bucket for published snapshots; granted read when set |
| `snapshotSkipDatabases` | `true` | restore the chain state only (`--skip-databases`) and leave eth and cirrus on the shared cluster alone; `false` only for the first cell of an empty cluster |
| `autoPromote` | `false` | watch the writer lease and take it after `autoPromoteAfter` (3) consecutive stale observations, about a minute of silence; each claim is counted in CloudWatch (`STRATO/Cell` `WriterLeaseClaimed`). Not for a validator's standby |
| `availabilityZone` | the VPC's first | pin the host to a zone, so two cells do not share one |
| `extraSetupFlags` | empty | appended to strato-setup verbatim on first boot (`--vaultUrl=...`) |
| `p2pCidrs` | `0.0.0.0/0` | who may reach 30303 tcp/udp |
| `clientSecurityGroupIds` | none | allowed on 8600 (the transaction ingress): the API tier's task security group, when it posts to the cells directly and not through the core tier's load balancer |
| `sshSourceSecurityGroupId` | none | allowed on 22 |
| `otelConfigParameterName` / `cloudWatchAgentParameterName` / `prometheusWorkspaceArn` | none | from the observability app; with a collector config the host runs the ADOT collector, its processes export spans to it, the role may write X-Ray, and (with `grafana`) the host's Grafana gets an X-Ray data source so the infrastructure map dashboard reads the service graph |
| `terminationProtection` | `true` | stack termination protection |

## Operating

- `sudo systemctl status strato-cell` / `journalctl -u strato-cell`;
  `strato-ps /var/lib/strato/node` lists the processes.
- `strato-cell-health` prints whether the cell can take transactions (every
  core process answers, the node is within 5 blocks of the network, and the
  cell is not draining), and serves that on port 8601 (200 or 503) for the
  core tier's load balancer. `journalctl -u strato-cell-watchdog` shows the
  watchdog, which restarts a node unhealthy for 2 minutes, at most once every
  30 (`WATCHDOG_RESTART_AFTER`, `WATCHDOG_RESTART_EVERY` and
  `WATCHDOG_RESTART_WAIT` in `/etc/strato/cell.env`, in seconds). If the node
  is still not following the chain `WATCHDOG_RESTART_WAIT` (10 minutes) after
  a restart, the watchdog marks its instance unhealthy and the Auto Scaling
  group replaces it, but only while another cell is healthy in the ingress
  target group and once the instance is `WATCHDOG_REPLACE_AFTER_AGE` (a day)
  old.
- To restart the node by hand: `sudo strato-cell-upgrade --restart`, which
  drains the cell first and waits until it follows the chain again.
- To change flags (writer, validator behaviour): `strato-down`, then
  `strato-setup --regenerate <original flags> <changes> /var/lib/strato/node`,
  then `systemctl start strato-cell`. The password argument is needed again;
  read it on the host from the secret, never into a shared log.
- Replacing the instance (a new instance type, a new AMI, a damaged node):
  deploy the stack, then `scripts/ha.sh <env> cells replace <id>`. The new
  instance starts on new volumes from the latest snapshot; nothing of the
  old one is kept.

## When the first boot fails

`/var/log/strato-cell-bootstrap.log` says where. The script stops at the first
error, and a failure in the setup or restore step leaves the host without its
systemd unit. Running `/opt/strato/bootstrap/cell-bootstrap.sh` again as root
is safe: setup and restore run only while the node directory does not exist,
so a second run carries on from the step after them.

`stratoImage` is one image of a release, and the node's compose file asks for
the others (prometheus, nginx, app-nginx) under the same version prefix, which
is the platform's git hash. A strato image rebuilt alone has a prefix the other
images were never pushed under, and `docker compose up` fails on a missing
tag: push or copy the full set before pointing a cell at it.

The same trap is in `strato-setup --regenerate`: it rewrites
`docker-compose.yml` with the version prefix of the binaries now on the host.
On a cell whose binaries were updated in place, the regenerated file asks for
image tags that host never pulled, `docker compose up` fails, convoke aborts,
and the node stays down **while systemd reports `strato-cell` active**. After
any `--regenerate` on such a cell, pull and tag the images (step 4c of the
bootstrap) before restarting, and check the processes afterwards
(`strato-ps`), not the unit.

## Deleting a cell stack

The Host stack has termination protection on, which also blocks deleting one
that rolled back before it created anything: clear it first
(`aws cloudformation update-termination-protection --no-enable-termination-protection`).
The instance and its volumes go with the stack.

## Not done here

- No AMI baking: every boot from scratch installs packages and pulls the
  image (about ten minutes). Bake an AMI from a bootstrapped host when the
  fleet grows.
- No automatic promotion; `strato-promote` is a human action.
- Snapshots restore the node directory, its JLog and Redis; a follower
  joining an existing cluster relies on the cluster already holding the
  chain's SQL mirror.
