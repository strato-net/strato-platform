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
  /** ACM certificate in us-east-1 plus the app's hostname, for CloudFront. */
  cloudfrontCertificateArn?: string;
  domainName?: string;
  /**
   * Secrets Manager names. `oauth` is JSON {discoveryUrl, clientId, clientSecret};
   * `backend` is JSON with the backend's optional API keys (STRIPE_SECRET_KEY,
   * SENDGRID_API_KEY, ...); the other two are plain strings.
   */
  secrets: {
    oauth: string;
    postgresPassword: string;
    session: string;
    backend?: string;
  };
  /** Plain (non-secret) backend settings passed through as-is. */
  backendEnvironment: Record<string, string>;
  /** Deploy app/ui/dist to the bucket (requires `npm run build` in app/ui first). */
  deployUi: boolean;
  desiredCount: number;
  /**
   * The app history service (phase 7). Present when `historyImage` is given:
   * its own Aurora Serverless cluster and a Fargate service under
   * /history-api on the app ALB. `busBootstrap` is host:port of the message
   * bus; `busSecretName` a Secrets Manager JSON {username, password} SCRAM
   * credential (the data-plane bus stack's AmazonMSK_ app secret).
   */
  history?: {
    image: string;
    desiredCount: number;
    busBootstrap?: string;
    busSecurity: string;
    busSecretName?: string;
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
    secrets: {
      oauth: ctx(app, "oauthSecretName", "strato/app/oauth"),
      postgresPassword: ctx(app, "postgresPasswordSecretName", "strato/app/postgres-password"),
      session: ctx(app, "sessionSecretName", "strato/app/session-secret"),
      backend: optional(app, "backendSecretName"),
    },
    backendEnvironment: ctx<Record<string, string>>(app, "backendEnvironment", {}),
    deployUi: String(ctx(app, "deployUi", "false")) === "true",
    desiredCount: Number(ctx(app, "desiredCount", "2")),
    history: optional(app, "historyImage")
      ? {
          image: ctx(app, "historyImage"),
          desiredCount: Number(ctx(app, "historyDesiredCount", "1")),
          busBootstrap: optional(app, "busBootstrap"),
          busSecurity: ctx(app, "busSecurity", "sasl_ssl"),
          busSecretName: optional(app, "busSecretName"),
        }
      : undefined,
  };
}
