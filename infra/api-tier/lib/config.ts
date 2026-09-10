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
  albCertificateArn?: string;
  /** Weighted cutover: the node hostname's zone and the current node addresses. */
  hostedZoneId?: string;
  domainName?: string;
  nodeIpAddresses: string[];
  apiTierWeight: number;
  desiredCount: number;
  /** Observability (optional): SSM parameter holding the ADOT sidecar config and the IAM policy it needs, both outputs of the observability app. */
  otelConfigParameterName?: string;
  otelSidecarPolicyArn?: string;
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
    albCertificateArn: optional(app, "albCertificateArn"),
    hostedZoneId: optional(app, "hostedZoneId"),
    domainName: optional(app, "domainName"),
    nodeIpAddresses: String(ctx(app, "nodeIpAddresses", "")).split(",").map((s) => s.trim()).filter(Boolean),
    apiTierWeight: Number(ctx(app, "apiTierWeight", "0")),
    desiredCount: Number(ctx(app, "desiredCount", "2")),
    otelConfigParameterName: optional(app, "otelConfigParameterName"),
    otelSidecarPolicyArn: optional(app, "otelSidecarPolicyArn"),
  };
}
