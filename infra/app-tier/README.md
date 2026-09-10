# STRATO app tier on AWS

CDK app for Phase 1 of the tiered deployment: the app tier runs on its own,
away from the node.

| Stack | What it holds |
|---|---|
| `StratoApp-<env>-Network` | The VPC (imported with `-c vpcId=...`, or a new two-AZ VPC). |
| `StratoApp-<env>-Tier` | ECS Fargate service: the app's nginx (OAuth, CSRF, sessions) and the backend in one task, behind an ALB; ElastiCache Redis for nginx's shared state. |
| `StratoApp-<env>-Ui` | The UI bundle in S3 behind CloudFront, with `/api/*`, `/auth/*`, `/login`, `/rpc`, `/api-docs*` routed to the ALB so the browser sees one origin. |

## Before deploying

1. Build and push the images: `make app-backend app-nginx` at the repo root, then push to ECR.
2. Create the secrets in Secrets Manager (names are context values, defaults shown):
   - `strato/app/oauth`: JSON `{"discoveryUrl": ..., "clientId": ..., "clientSecret": ...}` for the app's own OIDC client
   - `strato/app/postgres-password`: the node's Postgres password (plain string)
   - `strato/app/session-secret`: 64 random characters (plain string)
   - optionally a JSON secret with the backend's API keys (`-c backendSecretName=...`)
3. Build the UI: `cd app/ui && npm ci && npm run build`.
4. Allow the task security group (stack output `TaskSecurityGroupId`) on the node's Postgres port.

## Deploy

```sh
cd infra/app-tier && npm ci
npx cdk synth --strict \
  -c envName=testnet \
  -c nginxImage=<ecr>/app-nginx:<tag> -c backendImage=<ecr>/app-backend:<tag> \
  -c nodeUrl=https://node.testnet.example -c postgresHost=10.0.1.10 \
  -c chainId=8081 -c networkName=helium \
  -c domainName=app.testnet.example -c cloudfrontCertificateArn=<us-east-1 cert> -c albCertificateArn=<regional cert> \
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
