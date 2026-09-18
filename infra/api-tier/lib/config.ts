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
  /**
   * The front door (FrontDoorStack): one hostname for every UI. CloudFront serves the app UI
   * (app/ui/dist) at / and the SMD at /smd/ from their own buckets, sends the app backend's
   * paths to `appOriginDomainName` (the app tier's ALB, which must carry a certificate for
   * the front door's hostname) and the node API, apex, RPC, docs and login paths to this
   * tier. A DNS-validated certificate is created for the hostname and attached to this ALB.
   */
  frontDoorDomainName?: string;
  /** An existing us-east-1 certificate for `frontDoorDomainName`; without one the app creates a DNS-validated one. */
  frontDoorCertificateArn?: string;
  appOriginDomainName?: string;
  /** Where the front door sends this tier's paths, when the tier has no public hostname of its own: its ALB's DNS name. Defaults to `domainName`. */
  apiOriginDomainName?: string;
  deployAppUi: boolean;
  /** Values for the app UI's config.js (as app/ui/render-config.sh writes them). */
  appUiPosthogKey?: string;
  appUiPosthogHost?: string;
  appUiGoogleAnalyticsId?: string;
  /**
   * A Secrets Manager JSON {discoveryUrl, clientId, clientSecret} for nginx's login flow,
   * overriding the client in the node's OAuth credentials file (strato-api keeps that file).
   * Behind a front door both tiers' nginx must use the same client and session secret, so
   * that a session started by either tier is readable, and refreshable, by the other.
   */
  nginxOauthSecretName?: string;
  /**
   * One JSON secret {discoveryUrl, clientId, clientSecret} for every OAuth client here, instead of
   * `secrets.oauthCredentialsYaml`: strato-api builds its credentials file from the three values
   * (api-doit.sh) and nginx runs the login flow with them. The same secret serves the app tier
   * (`oauthSecretName` there) and a core cell (`oauthSecretId`), so one secret covers the deployment.
   */
  oauthJsonSecretName?: string;
  /**
   * The session secret nginx uses, when it differs from `secrets.session` (which this stack may own).
   * Behind a front door both tiers' nginx must share one secret: name the app tier's here, as its
   * complete ARN when the name ends in "-" and six characters (strato/app/session-secret does).
   */
  nginxSessionSecretName?: string;
  /**
   * A core cell's Prometheus as host:port (the core-cell app's exposePrometheus). apex reads the node's
   * health and consensus data there, instead of reporting it unknown; the cell's security group
   * (coreSecurityGroupId) is opened to the tasks on that port.
   */
  prometheusHost?: string;
  /**
   * A core cell running Grafana (the core-cell app's `grafana`): this ALB gains a /grafana* rule
   * forwarding to that instance, so the front door can reach it over the one public hostname, and
   * the cell's security group is opened on that port to this load balancer alone. Access control is
   * Grafana's own Keycloak login, not this rule.
   */
  grafanaInstanceId?: string;
  grafanaPort: number;
  /** Stateless CSRF tokens in nginx (CSRF_STATELESS=true): an HMAC of the session under the session secret, valid in every copy and tier sharing that secret. */
  csrfStateless: boolean;
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
    frontDoorDomainName: optional(app, "frontDoorDomainName"),
    frontDoorCertificateArn: optional(app, "frontDoorCertificateArn"),
    appOriginDomainName: optional(app, "appOriginDomainName"),
    apiOriginDomainName: optional(app, "apiOriginDomainName"),
    deployAppUi: String(ctx(app, "deployAppUi", "false")) === "true",
    appUiPosthogKey: optional(app, "appUiPosthogKey"),
    appUiPosthogHost: optional(app, "appUiPosthogHost"),
    appUiGoogleAnalyticsId: optional(app, "appUiGoogleAnalyticsId"),
    nginxOauthSecretName: optional(app, "nginxOauthSecretName"),
    oauthJsonSecretName: optional(app, "oauthJsonSecretName"),
    nginxSessionSecretName: optional(app, "nginxSessionSecretName"),
    csrfStateless: String(ctx(app, "csrfStateless", "false")) === "true",
    prometheusHost: optional(app, "prometheusHost"),
    grafanaInstanceId: optional(app, "grafanaInstanceId"),
    grafanaPort: Number(ctx(app, "grafanaPort", "3001")),
  };
}
