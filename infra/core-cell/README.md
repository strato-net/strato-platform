# STRATO core cell on AWS

CDK app for one core cell of the tiered deployment: an EC2 host running the
node's consensus, VM and indexer processes under convoke, with Redis, the
Kafka broker and Prometheus in containers beside them, against the shared
Aurora cluster from `infra/data-plane`. It is the same layout the testnet
hosts run by hand today, built from nothing at boot and supervised by systemd.

A cell is a **follower** by default: `--writer=false` (it indexes into the
cluster only when it holds the writer lease) and `--validatorBehavior=false`
(it never votes). Pass `-c writer=true` for the writer core. Promotion of a
running follower is `strato-promote` on the host; see
`design-documents/standby-core.md`.

## How the host is built

Ubuntu 24.04 (the strato image's base, so the image's binaries run on the
host unchanged). At first boot the instance, with its own role:

1. installs docker, the binaries' runtime libraries and the CloudWatch agent;
2. formats and mounts the data volume at `/var/lib/strato`;
3. pulls the strato image from ECR and copies its `/usr/local/bin` onto the
   host, plus the repo's `bin/strato-*` scripts (shipped as a stack asset);
4. reads the Aurora master secret and runs `strato-up --role=core ...` once,
   which sets the node directory up (`/var/lib/strato/node`), restores a
   snapshot when one was given, and starts convoke;
5. hands the node to `strato-cell.service` (systemd: `strato-up` on start,
   `strato-down` on stop, enabled at boot);
6. starts the ADOT collector and the CloudWatch agent when the observability
   app's configs are named.

The bootstrap log is `/var/log/strato-cell-bootstrap.log`; the node's logs
are under `/var/lib/strato/node/logs`. `aws ssm start-session --target
<instance>` gets a shell without SSH.

## Before deploying

1. The `strato` image in ECR (`make docker`), and the `prometheus` and
   streaming images beside it under the same registry prefix (the generated
   compose pulls them with `--repoUrl`).
2. The Aurora cluster (`infra/data-plane`), allowing this stack's security
   group (output `SecurityGroupId`) on 5432, and its master secret
   `strato/<env>/postgres`.
3. The network's VPC id when the cell must peer with existing validators
   over private addresses (`-c vpcId`); otherwise the app creates a VPC.
4. Optionally the observability app's outputs: the cell collector and
   CloudWatch agent SSM parameter names and the Prometheus workspace ARN.

## Deploy

```sh
npm install
npx cdk synth --strict \
  -c envName=testnet -c cellId=core-b -c vpcId=vpc-0123 \
  -c stratoImage=123456789012.dkr.ecr.us-east-1.amazonaws.com/strato:18.10-abcdef \
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
`SecurityGroupId` on the Aurora security group, and pass the output `PrivateDnsName` as `-c kafkaHost` to the API tier so it
submits transactions to this cell.

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
| `stratoImage` | required | ECR URI with tag |
| `repoUrl` | registry prefix of `stratoImage` | `--repoUrl` for the generated compose |
| `extraBinariesS3` | none | `s3://bucket/prefix/` of extra binaries installed into `/usr/local/bin` (for an image that lacks one) |
| `network` | `upquark` | `--network`; carries the bootnodes and chain id |
| `postgresWriterHost` / `postgresReaderHost` / `postgresPort` / `postgresUser` | required / writer / 5432 / postgres | Aurora endpoints |
| `postgresSecretName` | `strato/<env>/postgres` | master secret, JSON with a `password` field |
| `postgresSecurityGroupId` | none | the cluster's security group; the stack opens it to the cell on the Postgres port |
| `role` | `core` | `node` also runs the app on this host (nginx on httpPort/443, app UI and backend, SMD, apex, PostgREST); needs those images under `repoUrl` |
| `bundledApp` | `true` | with role node: run app-ui and app-backend on this host; `false` when the app tier serves the app (the node's root redirects to `appUrl`) |
| `appUrl` | none | the app tier's public URL, with `bundledApp=false` |
| `bundledSmd` | `true` | with role node: run the SMD on this host; `false` when it is served from S3 behind CloudFront (the node's `/smd` redirects to `smdUrl`) |
| `smdUrl` | none | the SMD deployment's public URL, with `bundledSmd=false` |
| `bundledPostgrest` | `true` | with role node: run PostgREST (the Cirrus API at `/cirrus`) on this host; `false` when the API tier serves Cirrus (the node's `/cirrus` answers 502) |
| `localAuth` | `false` | with role node: local OpenID provider instead of Keycloak; admin `admin`, password in `/etc/strato/local-auth-admin-password` on the host |
| `oauthSecretName` | none | without localAuth: Secrets Manager secret, JSON `{discoveryUrl, clientId, clientSecret}`, holding the node's Keycloak client (confidential, service accounts enabled, the node's URL among its redirect URIs). The host writes it as strato-login would; strato-setup then creates the node key in the shared vault (`--vaultUrl`, default vault.blockapps.net) under that client |
| `frontendLabels` | none | with `grafana`: names for the tier map's CloudFront distributions (`E123ABC=SMD,E456DEF=App UI`) |
| `ethconfParameterName` | none | SSM parameter this cell publishes its generated `ethconf.yaml` to (base64, SecureString, rewritten each boot): the API tier reads it as its node config (`-c ethconfParameterName=` there). Set it on the writer cell only |
| `exposePrometheus` | `false` | publish the node's Prometheus on the cell's private IP, port 9090 (a socat container), for the API tier's apex: pass `-c prometheusHost=<PrivateDnsName>:9090` there |
| `grafana` | `false` | Grafana container on port 3001 (anonymous viewer; admin password in `/etc/strato/grafana-admin-password`) over the node's Prometheus, with the repo's dashboards |
| `tlsHostname` / `letsEncryptEmail` | none | public hostname (an A record to the cell's Elastic IP): the host obtains a Let's Encrypt certificate for it over port 80, sets its hostname to it, and the node serves `https://<hostname>/` (the app URL, the OAuth issuer) |
| `webCidrs` | `0.0.0.0/0` | who may reach the app (`httpPort`, 443) |
| `grafanaCidrs` | none | who may reach Grafana (3001). Empty means no ingress rule: Grafana serves plain HTTP with anonymous viewer access, so it must not inherit the public `webCidrs`. Reach it with `aws ssm start-session --target <instance> --document-name AWS-StartPortForwardingSession --parameters '{"portNumber":["3001"],"localPortNumber":["3001"]}'`, or name your own networks here |
| `httpPort` | `8081` | the node's HTTP port; nginx publishes it (plain HTTP) and 443 |
| `peerStore` | `sqlite` | where the cell keeps peers and sync tasks (`--peerStore`): `sqlite` is a file in the node directory, so a database failover or maintenance no longer restarts ethereum-discover and strato-p2p; `postgres` keeps them in the cluster as a monolith does
| `peerDatabase` | none | per-cell peer store database on Postgres (`--peerDatabase`); only read with `peerStore: postgres`. strato-p2p keeps block reads on the eth database and peers on this one |
| `writer` | `false` | claim the writer lease at start |
| `validatorBehavior` | `false` | vote in consensus |
| `vmQuery` | `false` | run vm-query on the cell |
| `snapshotSource` | none | `s3://bucket/key.tar.zst`, or a published timestamp / `latest` |
| `snapshotBucket` | `strato-snapshots` | bucket for published snapshots; granted read when set |
| `extraSetupFlags` | empty | appended to strato-setup verbatim on first boot (`--vaultUrl=...`) |
| `p2pCidrs` | `0.0.0.0/0` | who may reach 30303 tcp/udp |
| `clientSecurityGroupIds` | none | allowed on 9094 (Kafka), 3000 and 8545: the API tier's task security group |
| `sshSourceSecurityGroupId` | none | allowed on 22 |
| `otelConfigParameterName` / `cloudWatchAgentParameterName` / `prometheusWorkspaceArn` | none | from the observability app; with a collector config the host runs the ADOT collector, its processes export spans to it, the role may write X-Ray, and (with `grafana`) the host's Grafana gets an X-Ray data source so the infrastructure map dashboard reads the service graph |
| `terminationProtection` | `true` | stack termination protection and instance retention |

## Operating

- `sudo systemctl status strato-cell` / `journalctl -u strato-cell`;
  `strato-ps /var/lib/strato/node` lists the processes.
- To change flags (writer, validator behaviour): `strato-down`, then
  `strato-setup --regenerate <original flags> <changes> /var/lib/strato/node`,
  then `systemctl start strato-cell`. The password argument is needed again;
  read it on the host from the secret, never into a shared log.
- Replacing the instance (a new instance type, a new AMI) keeps the data
  volume only if it is detached and reattached by hand; the stack does not
  do that for you. A follower can instead be rebuilt from a snapshot.

## Not done here

- No AMI baking: every boot from scratch installs packages and pulls the
  image (about ten minutes). Bake an AMI from a bootstrapped host when the
  fleet grows.
- No automatic promotion; `strato-promote` is a human action.
- Snapshots restore the node directory, Redis and the local Kafka; a
  follower joining an existing cluster relies on the cluster already holding
  the chain's SQL mirror.
