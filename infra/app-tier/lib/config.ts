import { App } from "aws-cdk-lib";
import { deploymentPrefix } from "./naming";

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
  /** An existing ECS cluster for this tier's services: the deployment's one cluster, which the API tier app creates (its ClusterName output). Without it the tier gets a cluster of its own. */
  clusterName?: string;
  /** Image URIs for the app's nginx and backend, as strato-platform's autobuild publishes them: ghcr.io/strato-net/strato-platform/app-nginx:<VERSION>-<commit>-<hash>, app-backend likewise (public; an ECR URI is pulled with the task's ECR permissions). */
  nginxImage: string;
  backendImage: string;
  /** Public URL of the STRATO API tier or node the app talks to. */
  nodeUrl: string;
  /** Postgres host serving the cirrus database (the node, until the managed cluster exists). */
  postgresHost: string;
  postgresPort: number;
  /** The node's database login (the data-plane app's NodeLogin), not the cluster's master login. */
  postgresUser: string;
  /** Node network identity, rendered into the UI's config.js. */
  chainId: number;
  networkName: string;
  /** ACM certificate (in this region) for the ALB; HTTP-only when absent. */
  albCertificateArn?: string;
  /** More certificates for the ALB's HTTPS listener: the front door's hostname, which CloudFront forwards as Host (the API tier app's FrontDoorCertificate output). */
  extraCertificateArns: string[];
  /** Stateless CSRF tokens in nginx (CSRF_STATELESS=true): an HMAC of the session under the session secret, valid in every copy and tier sharing that secret. Required behind a front door shared with the API tier. */
  csrfStateless: boolean;
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
    /** When set, `postgresPassword` names a JSON secret and this is the key holding the password ("password" in the data-plane app's NodeLoginSecretName). */
    postgresPasswordJsonKey?: string;
    session: string;
    backend?: string;
    /**
     * The keys `backend` holds. ECS refuses to start a task whose secret lacks a key it maps, and
     * every key is optional to the backend, so name only those present; unset maps them all.
     */
    backendKeys?: string[];
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
  /**
   * The partner referrals service of the network this deployment follows: its URL
   * (PARTNER_REFERRALS_URL) and the Secrets Manager name or complete ARN of its internal key, a
   * plain string the service itself reads (PARTNER_INTERNAL_KEY; referenced, not copied). Without
   * both the backend records no referrals.
   */
  partnerReferrals?: { url: string; internalKeySecretName: string };
  /**
   * Proxies in front of the load balancer whose X-Forwarded-For entry nginx takes as the client's
   * address (NGINX_TRUST_PROXY_CIDRS), beside the VPC's own range, which covers the load balancer
   * and is always trusted: behind the front door, CloudFront's origin-facing ranges. Each trusted
   * hop appends the peer it saw, so a client cannot pass a forged address through them.
   */
  trustedProxyCidrs: string[];
  /** Deploy app/ui/dist to the bucket (requires `npm run build` in app/ui first). */
  deployUi: boolean;
  /** The Ui stack (S3 + CloudFront). `-c ui=false` leaves it out when the API tier app's front door serves the app UI. */
  uiStack: boolean;
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
   * of its own. It feeds from the Cirrus poller.
   */
  history?: {
    image: string;
    desiredCount: number;
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
  const envName = ctx(app, "envName", "testnet");
  const prefix = deploymentPrefix(envName);
  const partnerReferralsUrl = optional(app, "partnerReferralsUrl");
  const partnerInternalKeySecretName = optional(app, "partnerInternalKeySecretName");
  if (Boolean(partnerReferralsUrl) !== Boolean(partnerInternalKeySecretName)) {
    throw new Error("partnerReferralsUrl and partnerInternalKeySecretName go together: pass both or neither");
  }
  return {
    envName,
    vpcId: optional(app, "vpcId"),
    clusterName: optional(app, "clusterName"),
    nginxImage: ctx(app, "nginxImage"),
    backendImage: ctx(app, "backendImage"),
    nodeUrl: ctx(app, "nodeUrl"),
    postgresHost: ctx(app, "postgresHost"),
    postgresPort: Number(ctx(app, "postgresPort", "5432")),
    postgresUser: ctx(app, "postgresUser", "strato"),
    chainId: Number(ctx(app, "chainId")),
    networkName: ctx(app, "networkName"),
    albCertificateArn: optional(app, "albCertificateArn"),
    extraCertificateArns: String(ctx(app, "extraCertificateArns", "")).split(",").map((s) => s.trim()).filter(Boolean),
    csrfStateless: String(ctx(app, "csrfStateless", "false")) === "true",
    cloudfrontCertificateArn: optional(app, "cloudfrontCertificateArn"),
    domainName: optional(app, "domainName"),
    oauthDiscoveryUrl: optional(app, "oauthDiscoveryUrl"),
    secrets: {
      oauth: ctx(app, "oauthSecretName", `${prefix}/app/oauth`),
      postgresPassword: ctx(app, "postgresPasswordSecretName", `${prefix}/app/postgres-password`),
      postgresPasswordJsonKey: optional(app, "postgresPasswordJsonKey"),
      session: ctx(app, "sessionSecretName", `${prefix}/app/session-secret`),
      backend: optional(app, "backendSecretName"),
      backendKeys: optional(app, "backendSecretKeys")?.split(",").map((s) => s.trim()).filter(Boolean),
    },
    createSessionSecret: String(ctx(app, "createSessionSecret", "false")) === "true",
    postgresSecurityGroupId: optional(app, "postgresSecurityGroupId"),
    ethconfParameterName: optional(app, "ethconfParameterName"),
    httpPort: Number(ctx(app, "httpPort", "80")),
    backendEnvironment: ctx<Record<string, string>>(app, "backendEnvironment", {}),
    partnerReferrals: partnerReferralsUrl && partnerInternalKeySecretName
      ? { url: partnerReferralsUrl, internalKeySecretName: partnerInternalKeySecretName }
      : undefined,
    trustedProxyCidrs: String(ctx(app, "trustedProxyCidrs", "")).split(",").map((s) => s.trim()).filter(Boolean),
    deployUi: String(ctx(app, "deployUi", "false")) === "true",
    uiStack: String(ctx(app, "ui", "true")) === "true",
    desiredCount: Number(ctx(app, "desiredCount", "2")),
    otelConfigParameterName: optional(app, "otelConfigParameterName"),
    otelSidecarPolicyArn: optional(app, "otelSidecarPolicyArn"),
    history: optional(app, "historyImage")
      ? {
          image: ctx(app, "historyImage"),
          desiredCount: Number(ctx(app, "historyDesiredCount", "1")),
          database: optional(app, "historyDatabaseHost")
            ? {
                host: ctx(app, "historyDatabaseHost"),
                port: Number(ctx(app, "historyDatabasePort", "5432")),
                user: ctx(app, "historyDatabaseUser", "strato"),
                secretName: ctx(app, "historyDatabaseSecretName", `${prefix}/postgres/node`),
                securityGroupId: optional(app, "historyDatabaseSecurityGroupId"),
              }
            : undefined,
        }
      : undefined,
  };
}
