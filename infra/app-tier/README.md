# STRATO app tier on AWS

CDK app for Phase 1 of the tiered deployment: the app tier runs on its own,
away from the node.

| Stack | What it holds |
|---|---|
| `StratoApp-<env>-Network` | The VPC (imported with `-c vpcId=...`, or a new two-AZ VPC). |
| `StratoApp-<env>-Tier` | ECS Fargate service: the app's nginx (OAuth, CSRF, sessions) and the backend in one task, behind an ALB with session stickiness; sessions in the encrypted cookie, CSRF tokens per copy, no shared store. |
| `StratoApp-<env>-Ui` | The UI bundle in S3 behind CloudFront, with `/api/*`, `/auth/*`, `/login`, `/rpc`, `/api-docs*` routed to the ALB so the browser sees one origin. |

## Before deploying

1. Build and push the images: `make app-backend app-nginx` at the repo root, then push to ECR. The sidecar must be the **app-nginx** image (app/nginx: it proxies /api to the backend beside it and the node paths to `NODE_URL`, listens on 80); the node's `nginx` image expects the node's layout and will not start here.
2. Create the secrets in Secrets Manager (names are context values, defaults shown):
   - `strato/app/oauth`: JSON `{"discoveryUrl": ..., "clientId": ..., "clientSecret": ...}` for the app's own OIDC client
   - `strato/app/postgres-password`: the node's Postgres password (plain string)
   - `strato/app/session-secret`: 64 random characters (plain string)
   - optionally a JSON secret with the backend's API keys (`-c backendSecretName=...`)
3. Build the UI: `cd app/ui && npm ci && npm run build`.
4. Allow the task security group (stack output `TaskSecurityGroupId`) on the node's Postgres port.
5. **`-c nodeUrl=...` must already resolve in DNS.** The backend will not serve
   until `<nodeUrl>/strato-api/eth/v1.2/metadata` answers `isSynced: true`, and
   it cannot tell a name that does not resolve from a node that is behind: it
   logs `Node is still syncing` every 30 s, the task never turns healthy, and
   CloudFormation eventually rolls the stack back. When the app tier sits behind
   a front door, deploy the front door and point its record at the distribution
   *before* deploying this stack.

## Deploy

```sh
cd infra/app-tier && npm ci
npx cdk synth --strict \
  -c envName=testnet \
  -c nginxImage=<ecr>/app-nginx:<tag> -c backendImage=<ecr>/app-backend:<tag> \
  -c nodeUrl=https://node.testnet.example -c postgresHost=10.0.1.10 \
  -c chainId=8081 -c networkName=helium \
  -c domainName=app.testnet.example -c albCertificateArn=<regional cert> \
  -c deployUi=true
npx cdk diff ...   # same context
npx cdk deploy --all ...
```

Cutover is the DNS record for the app hostname: point it at the CloudFront
distribution once the stack is healthy, and set `--bundledApp=false
--appUrl=https://app.testnet.example` on the node so its root redirects there.
Rolling back is the DNS record again; the node keeps serving the bundled app
until it is re-set-up without it.

Context values can also live in `cdk.context.json` per environment.

## History service (phase 7)

Deploys when `-c historyImage=...` is given: a Fargate service under
`/history-api` on the app ALB. Its tables go into a `history` database on
the chain's Aurora cluster when `-c historyDatabaseHost=<writer endpoint>`
is set (with `historyDatabasePort`, `historyDatabaseUser`,
`historyDatabaseSecretName` defaulting to 5432, postgres and
`strato/<env>/postgres`, and `historyDatabaseSecurityGroupId` to open the
cluster to the service); that is one cluster to run and the history writes
are small. Without it the stack creates an Aurora Serverless v2 cluster of
its own (0.5 to 8 ACU), which is the place to move to if chart queries show
in the chain replicas' metrics. The service feeds from the Cirrus poller;
add `-c busBootstrap=host:port -c busSecretName=...` to also consume
`chain_events` from the message bus.

Security groups: pass `-c postgresSecurityGroupId=<Aurora cluster SG>` and the stack opens them to its task security group at deploy time; otherwise allow the output `TaskSecurityGroupId` by hand.

## Hostname and certificate

`-c domainName=<host>` names the app's public hostname. Without
`-c cloudfrontCertificateArn`, the app adds `StratoApp-<env>-Certificate`
(in us-east-1, where CloudFront certificates live) holding a DNS-validated
ACM certificate. That stack stays in `CREATE_IN_PROGRESS` until the
validation CNAME ACM asks for exists at the registrar; the record is in the
stack's events and in `aws acm describe-certificate`. Then the Ui stack
adds the hostname as a CloudFront alias, and its `HostnameRecord` output is
the CNAME to create for the hostname itself (CloudFront has no fixed IPs).

The backend gets `OAUTH_DISCOVERY_URL` alone (pass `-c oauthDiscoveryUrl`
to give it in plain rather than from the `oauth` secret): it only verifies
users' tokens with the provider's JWKS. The node's read APIs and
unsigned-transaction endpoints are open, so it calls them on behalf of
anonymous users without a token. The client id and secret go to nginx,
which runs the login flow. That flow needs the app hostname's callback
(`https://<host>/auth/openidc/return`) registered on the OAuth client.

## Behind the API tier's front door

When the API tier app's front door serves every UI on one hostname (see its
README), this tier is the origin for `/api/*`, `/api-docs*` and
`/history-api/*`, and the `Ui` stack is no longer needed:

- `-c albCertificateArn=<this tier's hostname certificate>` so the ALB serves
  https, and `-c extraCertificateArns=<the front door's CertificateArn>` because
  CloudFront forwards the front door's Host header.
- `-c csrfStateless=true` (nginx image 18.10-onehost or later), and the same
  session secret and OAuth client as the API tier's nginx.
- This tier's hostname can then point straight at the ALB (`AlbDnsName`).
- `-c ui=false` leaves the `Ui` stack out of the app; destroy a deployed one
  with `cdk destroy <prefix>-Ui` (its bucket is retained; empty and delete it
  by hand).

