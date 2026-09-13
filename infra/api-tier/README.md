# STRATO API tier on AWS

CDK app for Phase 3 of the tiered deployment: strato-api, ethereum-jsonrpc,
PostgREST, and the SMD with apex, behind the node's nginx as a sidecar, all
in one Fargate task per copy behind an ALB. The copies share no edge state:
nginx sessions ride in the encrypted session cookie (one `session_secret` for
every copy), CSRF tokens stay in each copy's shared dict behind the ALB's
session stickiness, and bloc's nonce counters are rows in the eth database's
writer (`nonce_counter`), which every copy already shares.

Data paths: eth reads go to the Aurora reader endpoint, writes and the
resolve poll to the writer, Cirrus to the reader, and transactions and VM
calls to the core node's VPC-facing Kafka listener (port 9094, enabled with
`strato-setup --kafkaExternalHost=<private host>`).

## Before deploying

1. Images in ECR: `strato`, `nginx`, `postgrest`, and optionally `smd` and
   `apex` (`make docker`).
2. The Aurora cluster (`infra/data-plane`) and a core node with
   `--kafkaExternalHost`, both allowing this stack's task security group
   (output `TaskSecurityGroupId`) on 5432 and 9094 respectively.
3. Secrets Manager: the Aurora master secret (from the data-plane stack), the
   node's `secrets/oauth_credentials.yaml` contents as a plain-string secret,
   and a 64-character session secret. SSM Parameter Store: the node's
   `.ethereumH/ethconf.yaml` base64-encoded, under the name given as
   `ethconfParameterName` (about 2.6 KB; fits a standard parameter).
4. A regional ACM certificate for the node hostname.

## Deploy and cut over

```sh
cd infra/api-tier && npm ci
npx cdk deploy --all \
  -c envName=testnet -c vpcId=vpc-0123 \
  -c stratoImage=<ecr>/strato:<tag> -c nginxImage=<ecr>/nginx:<tag> -c postgrestImage=<ecr>/postgrest:<tag> \
  -c smdImage=<ecr>/smd:<tag> -c apexImage=<ecr>/apex:<tag> \
  -c postgresWriterHost=<writer> -c postgresReaderHost=<reader> \
  -c kafkaHost=<core private host> \
  -c albCertificateArn=<cert> \
  -c hostedZoneId=Z123 -c domainName=node.testnet.example -c nodeIpAddresses=1.2.3.4 \
  -c apiTierWeight=10
```

The stack owns two weighted records for the node hostname: `node` (the
existing address) and `api-tier` (the ALB). Delete the hostname's existing
simple record first, or import it. Raise `apiTierWeight` in steps as these
stay clean, and finish at 100:

- duplicate-nonce rejections: zero (`grep -c "nonce" logs/strato-sequencer` on the core, or the sequencer's rejection metric)
- CSRF 403s on the ALB: zero (`nginx_http_requests_total{status="403"}`)
- Aurora replica lag under 1 s (`AuroraReplicaLag`)
- `/eth/v1.2/metadata` from the ALB reports `isSynced: true`

Rolling back is the same weight going down. The node keeps serving until
the weight is 100 and has been for a while; then re-set-up the node with
`--role=core` at the next window.

Security groups: pass `-c postgresSecurityGroupId=<Aurora cluster SG>` and `-c coreSecurityGroupId=<core cell SG>` and the stack opens them to its task security group at deploy time; otherwise allow the output `TaskSecurityGroupId` by hand.

## Hostname and certificate

Outside Route 53, `-c domainName=<host>` (with no `hostedZoneId`) names the
tier's public hostname. Without `-c albCertificateArn`, the app adds
`StratoApi-<env>-Certificate` holding a DNS-validated ACM certificate; that
stack stays in `CREATE_IN_PROGRESS` until the validation CNAME ACM asks for
exists at the registrar (the record is in the stack's events and in `aws acm
describe-certificate`). The Tier stack then serves HTTPS on 443 with it and
redirects port 80, and its `HostnameRecord` output is the CNAME to create
for the hostname itself (the ALB has no fixed IPs). Anything that reached
the tier over plain HTTP (the app tier's `nodeUrl`) must move to
`https://<host>` at the same time.

## SMD on CloudFront

`-c smdDomainName=smd.example.com` adds two stacks. `<prefix>-SmdCertificate`
is a DNS-validated certificate for that hostname (the validation CNAME goes to
the registrar; the stack waits for it). `<prefix>-Smd` serves the SMD bundle
from a private S3 bucket behind CloudFront at `/smd/`, and sends the node API,
apex, RPC and login paths (`/strato/*`, `/strato-api*`, `/bloc/*`, `/cirrus/*`,
`/apex-api*`, `/apex-ws/*`, `/rpc*`, `/login*`, `/auth/*`) to this tier over
https, so the browser keeps one origin and its session and CSRF cookies. A
viewer-request function redirects `/` to `/smd/` and serves `index.html` for
the SMD's client-side routes.

CloudFront forwards the viewer's Host header, so login returns to the SMD's
hostname; CloudFront then checks the origin certificate against that Host, so
the same certificate is also attached to this tier's HTTPS listener.

- Build first: `npm ci && npm run build` in `smd-ui` (base path `/smd/`).
- Context: `-c deploySmdUi=true -c chainId=<id> -c networkName=<name>`
  (`-c wagmiProjectId=` optional) for the SMD's `config.js`.
- The SMD needs apex: pass `-c apexImage=...` so the task runs it.
- The OAuth client needs `https://<smdDomainName>/*` among its redirect and
  post-logout URIs.
- Outputs: `HostnameRecord` (the CNAME to create) and `DistributionId` (name
  it in the tier map's `frontend_labels`, `<id>=SMD`).

## API docs

The task runs Swagger UI (`swaggerapi/swagger-ui`) as the `docs` container on
port 8080, and the nginx sidecar serves it at `/docs/`, as on a node: the
spec (`/docs/swagger.yaml`) and the initializer come from the nginx image
itself. The container is not essential, so a docs failure never takes the
API down. `-c docsImage=<uri>` points at a mirror (an ECR URI is pulled with
the task's ECR permissions); `-c docs=false` leaves it out, and `/docs/` then
answers 502.
