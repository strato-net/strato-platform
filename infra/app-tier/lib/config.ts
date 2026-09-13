import { App } from "aws-cdk-lib";

/**
 * Everything the app tier needs that differs between environments, read from
 * CDK context (`-c key=value` or cdk.context.json). Secrets are named, never
 * valued: ECS injects them from Secrets Manager at task start.
 */
export interface AppTierConfig {
  /** Short environment name used in resource names, e.g. "testnet". */
  envName: string;
  /** Existing VPC to deploy into; a new one is created when absent. */
  vpcId?: string;
  /** ECR image URIs for the app's nginx and backend (from `make app-nginx` / `make app-backend`). */
  nginxImage: string;
  backendImage: string;
  /** Public URL of the STRATO API tier or node the app talks to. */
  nodeUrl: string;
  /** Postgres host serving the cirrus database (the node, until the managed cluster exists). */
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  /** Node network identity, rendered into the UI's config.js. */
  chainId: number;
  networkName: string;
  /** ACM certificate (in this region) for the ALB; HTTP-only when absent. */
  albCertificateArn?: string;
  /** The app's public hostname (a CNAME to the CloudFront distribution at the registrar). */
  domainName?: string;
  /** An existing us-east-1 certificate for it; without one the app creates a DNS-validated certificate (CertificateStack, in us-east-1). */
  cloudfrontCertificateArn?: string;
  /** The OpenID discovery URL for the backend, in plain: it only verifies users' tokens with it. Without it the backend reads the URL from the `oauth` secret. */
  oauthDiscoveryUrl?: string;
  /**
   * Secrets Manager names. `oauth` is JSON {discoveryUrl, clientId, clientSecret} for
   * nginx's login flow (the backend gets no client credentials: the node's read APIs are open);
   * `backend` is JSON with the backend's optional API keys (STRIPE_SECRET_KEY,
   * SENDGRID_API_KEY, ...); the other two are plain strings.
   */
  secrets: {
    oauth: string;
    postgresPassword: string;
    /** When set, `postgresPassword` names a JSON secret and this is the key holding the password (the data-plane master secret's "password"). */
    postgresPasswordJsonKey?: string;
    session: string;
    backend?: string;
  };
  /** Create the session secret (64 random characters) under `secrets.session` instead of importing one. */
  createSessionSecret: boolean;
  /** The Aurora cluster's security group, opened to the tasks on the Postgres port at deploy time. */
  postgresSecurityGroupId?: string;
  /** SSM parameter holding a node ethconf.yaml base64-encoded: the nginx sidecar reads the node's ports and URLs from it (the API tier's parameter serves). */
  ethconfParameterName?: string;
  /** The port the app's nginx (the app-nginx image) listens on: 80. */
  httpPort: number;
  /** Plain (non-secret) backend settings passed through as-is. */
  backendEnvironment: Record<string, string>;
  /** Deploy app/ui/dist to the bucket (requires `npm run build` in app/ui first). */
  deployUi: boolean;
  desiredCount: number;
  /** Observability (optional): SSM parameter holding the ADOT sidecar config and the IAM policy it needs, both outputs of the observability app. */
  otelConfigParameterName?: string;
  otelSidecarPolicyArn?: string;
  /**
   * The app history service (phase 7). Present when `historyImage` is given:
   * a Fargate service under /history-api on the app ALB, with its tables in
   * a `history` database on an existing Postgres cluster when
   * `historyDatabaseHost` is given (the chain's Aurora cluster: one cluster
   * to run, and the writes are small), else in an Aurora Serverless cluster
   * of its own. `busBootstrap` is host:port of the message bus (omit it to
   * feed from the Cirrus poller only); `busSecretName` a Secrets Manager JSON
   * {username, password} SCRAM credential (the data-plane bus stack's
   * AmazonMSK_ app secret).
   */
  history?: {
    image: string;
    desiredCount: number;
    busBootstrap?: string;
    busSecurity: string;
    busSecretName?: string;
    /** An existing cluster to hold the history database; the secret is JSON with a "password" field. */
    database?: {
      host: string;
      port: number;
      user: string;
      secretName: string;
      /** The cluster's security group, to allow the service on its port; omit to do that by hand. */
      securityGroupId?: string;
    };
  };
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/** A required context value, or one with a default. */
function ctx<T>(app: App, key: string, fallback?: T): T {
  const v = app.node.tryGetContext(key);
  if (present(v)) return v as T;
  if (fallback === undefined) throw new Error(`missing context value: ${key} (pass -c ${key}=...)`);
  return fallback;
}

/** An optional context value. */
function optional(app: App, key: string): string | undefined {
  const v = app.node.tryGetContext(key);
  return present(v) ? String(v) : undefined;
}

export function loadConfig(app: App): AppTierConfig {
  return {
    envName: ctx(app, "envName", "testnet"),
    vpcId: optional(app, "vpcId"),
    nginxImage: ctx(app, "nginxImage"),
    backendImage: ctx(app, "backendImage"),
    nodeUrl: ctx(app, "nodeUrl"),
    postgresHost: ctx(app, "postgresHost"),
    postgresPort: Number(ctx(app, "postgresPort", "5432")),
    postgresUser: ctx(app, "postgresUser", "postgres"),
    chainId: Number(ctx(app, "chainId")),
    networkName: ctx(app, "networkName"),
    albCertificateArn: optional(app, "albCertificateArn"),
    cloudfrontCertificateArn: optional(app, "cloudfrontCertificateArn"),
    domainName: optional(app, "domainName"),
    oauthDiscoveryUrl: optional(app, "oauthDiscoveryUrl"),
    secrets: {
      oauth: ctx(app, "oauthSecretName", "strato/app/oauth"),
      postgresPassword: ctx(app, "postgresPasswordSecretName", "strato/app/postgres-password"),
      postgresPasswordJsonKey: optional(app, "postgresPasswordJsonKey"),
      session: ctx(app, "sessionSecretName", "strato/app/session-secret"),
      backend: optional(app, "backendSecretName"),
    },
    createSessionSecret: String(ctx(app, "createSessionSecret", "false")) === "true",
    postgresSecurityGroupId: optional(app, "postgresSecurityGroupId"),
    ethconfParameterName: optional(app, "ethconfParameterName"),
    httpPort: Number(ctx(app, "httpPort", "80")),
    backendEnvironment: ctx<Record<string, string>>(app, "backendEnvironment", {}),
    deployUi: String(ctx(app, "deployUi", "false")) === "true",
    desiredCount: Number(ctx(app, "desiredCount", "2")),
    otelConfigParameterName: optional(app, "otelConfigParameterName"),
    otelSidecarPolicyArn: optional(app, "otelSidecarPolicyArn"),
    history: optional(app, "historyImage")
      ? {
          image: ctx(app, "historyImage"),
          desiredCount: Number(ctx(app, "historyDesiredCount", "1")),
          busBootstrap: optional(app, "busBootstrap"),
          busSecurity: ctx(app, "busSecurity", "sasl_ssl"),
          busSecretName: optional(app, "busSecretName"),
          database: optional(app, "historyDatabaseHost")
            ? {
                host: ctx(app, "historyDatabaseHost"),
                port: Number(ctx(app, "historyDatabasePort", "5432")),
                user: ctx(app, "historyDatabaseUser", "postgres"),
                secretName: ctx(app, "historyDatabaseSecretName", `strato/${ctx(app, "envName", "testnet")}/postgres`),
                securityGroupId: optional(app, "historyDatabaseSecurityGroupId"),
              }
            : undefined,
        }
      : undefined,
  };
}
