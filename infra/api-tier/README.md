# STRATO API tier on AWS

CDK app for Phase 3 of the tiered deployment: strato-api, ethereum-jsonrpc,
PostgREST, and the SMD with apex, behind the node's nginx as a sidecar, all
in one Fargate task per copy behind an ALB. State that must be shared by the
copies (bloc's nonce counters, nginx's CSRF tokens and sessions) lives in an
ElastiCache Redis.

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
