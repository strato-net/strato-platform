import { App } from "aws-cdk-lib";

/** Context contract for the API tier. Secrets are named, never valued. */
export interface ApiTierConfig {
  envName: string;
  vpcId?: string;
  /** ECR image URIs. */
  stratoImage: string;
  nginxImage: string;
  postgrestImage: string;
  smdImage?: string;
  apexImage?: string;
  /** Swagger UI for the API docs at /docs/ (the spec and initializer come from the nginx image). Default swaggerapi/swagger-ui:v5.29.2, as on a node; `-c docs=false` leaves it out. */
  docsImage?: string;
  /** Aurora endpoints (infra/data-plane outputs) and the core's VPC-facing Kafka listener. */
  postgresWriterHost: string;
  postgresReaderHost: string;
  postgresPort: number;
  postgresUser: string;
  kafkaHost: string;
  kafkaPort: number;
  /** The node's networkConfig.httpPort: nginx listens on it inside the container. */
  httpPort: number;
  /** Shared message bus (infra/data-plane MSK stack): bootstrap host, SASL/SCRAM secret, submit mode. */
  busHost?: string;
  busPort: number;
  busSubmitMode: string;
  busSecretName: string;
  /** Secrets Manager names: the Aurora master secret (JSON, "password" field), the node's
   * OAuth client credentials (YAML file contents), the nginx session secret, and the SSM
   * parameter holding the node's ethconf.yaml base64-encoded. */
  secrets: { postgres: string; oauthCredentialsYaml: string; session: string };
  ethconfParameterName: string;
  /** Create the session secret (64 random characters) under `secrets.session` instead of importing an existing one. */
  createSessionSecret: boolean;
  /** An existing regional certificate for the ALB. Without it, and with `domainName` set, the app creates a DNS-validated one (see CertificateStack). */
  albCertificateArn?: string;
  /** Security groups this stack opens to its tasks at deploy time: the Aurora cluster's (5432) and the core cell's (9094 Kafka, 3000 strato-api, 8545 jsonrpc). Without them, allow the output TaskSecurityGroupId by hand. */
  postgresSecurityGroupId?: string;
  coreSecurityGroupId?: string;
  /** The tier's public hostname. With `hostedZoneId` it is the node hostname being cut over (weighted records below); without one it is a CNAME to the ALB kept at the registrar. */
  domainName?: string;
  /** Weighted cutover: the node hostname's Route 53 zone and the current node addresses. */
  hostedZoneId?: string;
  nodeIpAddresses: string[];
  apiTierWeight: number;
  desiredCount: number;
  /** The core's vault wrapper (http://<core private host>:8093): strato-api signs through it. Empty leaves the ethconf's value. */
  vaultUrl?: string;
  /** Run vm-query in the task and serve latest-state calls from the mirror (phase 5). */
  vmQuery: boolean;
  /** Observability (optional): SSM parameter holding the ADOT sidecar config and the IAM policy it needs, both outputs of the observability app. */
  otelConfigParameterName?: string;
  otelSidecarPolicyArn?: string;
  /** The SMD from S3 behind CloudFront (SmdUiStack): its hostname (a DNS-validated certificate is created for it and also attached to this ALB, because CloudFront forwards the viewer's Host header and checks the origin certificate against it), whether to upload the bundle built in smd-ui/dist, and the chain values its config.js carries. */
  smdDomainName?: string;
  deploySmdUi: boolean;
  chainId?: string;
  networkName?: string;
  wagmiProjectId?: string;
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}
function ctx<T>(app: App, key: string, fallback?: T): T {
  const v = app.node.tryGetContext(key);
  if (present(v)) return v as T;
  if (fallback === undefined) throw new Error(`missing context value: ${key} (pass -c ${key}=...)`);
  return fallback;
}
function optional(app: App, key: string): string | undefined {
  const v = app.node.tryGetContext(key);
  return present(v) ? String(v) : undefined;
}

export function loadConfig(app: App): ApiTierConfig {
  const envName = ctx(app, "envName", "testnet");
  return {
    envName,
    vpcId: optional(app, "vpcId"),
    stratoImage: ctx(app, "stratoImage"),
    nginxImage: ctx(app, "nginxImage"),
    postgrestImage: ctx(app, "postgrestImage"),
    smdImage: optional(app, "smdImage"),
    apexImage: optional(app, "apexImage"),
    docsImage: String(ctx(app, "docs", "true")) === "true" ? ctx(app, "docsImage", "swaggerapi/swagger-ui:v5.29.2") : undefined,
    postgresWriterHost: ctx(app, "postgresWriterHost"),
    postgresReaderHost: ctx(app, "postgresReaderHost"),
    postgresPort: Number(ctx(app, "postgresPort", "5432")),
    postgresUser: ctx(app, "postgresUser", "postgres"),
    kafkaHost: ctx(app, "kafkaHost"),
    kafkaPort: Number(ctx(app, "kafkaPort", "9094")),
    httpPort: Number(ctx(app, "httpPort", "8081")),
    busHost: optional(app, "busHost"),
    busPort: Number(ctx(app, "busPort", "9096")),
    busSubmitMode: ctx(app, "busSubmitMode", "shadow"),
    busSecretName: ctx(app, "busSecretName", `AmazonMSK_strato-${envName}-api`),
    secrets: {
      postgres: ctx(app, "postgresSecretName", `strato/${envName}/postgres`),
      oauthCredentialsYaml: ctx(app, "oauthCredentialsSecretName", `strato/${envName}/api/oauth-credentials`),
      session: ctx(app, "sessionSecretName", `strato/${envName}/api/session-secret`),
    },
    ethconfParameterName: ctx(app, "ethconfParameterName", `/strato/${envName}/api/ethconf-base64`),
    createSessionSecret: String(ctx(app, "createSessionSecret", "false")) === "true",
    postgresSecurityGroupId: optional(app, "postgresSecurityGroupId"),
    coreSecurityGroupId: optional(app, "coreSecurityGroupId"),
    albCertificateArn: optional(app, "albCertificateArn"),
    hostedZoneId: optional(app, "hostedZoneId"),
    domainName: optional(app, "domainName"),
    nodeIpAddresses: String(ctx(app, "nodeIpAddresses", "")).split(",").map((s) => s.trim()).filter(Boolean),
    apiTierWeight: Number(ctx(app, "apiTierWeight", "0")),
    desiredCount: Number(ctx(app, "desiredCount", "2")),
    vmQuery: String(ctx(app, "vmQuery", "false")) === "true",
    vaultUrl: optional(app, "vaultUrl"),
    otelConfigParameterName: optional(app, "otelConfigParameterName"),
    otelSidecarPolicyArn: optional(app, "otelSidecarPolicyArn"),
    smdDomainName: optional(app, "smdDomainName"),
    deploySmdUi: String(ctx(app, "deploySmdUi", "false")) === "true",
    chainId: optional(app, "chainId"),
    networkName: optional(app, "networkName"),
    wagmiProjectId: optional(app, "wagmiProjectId"),
  };
}
