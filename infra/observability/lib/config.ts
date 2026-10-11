import { App } from "aws-cdk-lib";
import { GrafanaServiceConfig } from "./grafana-stack";

/**
 * Everything that differs between environments, from CDK context. The
 * managed-service identifiers are optional: an alarm is only created for a
 * service whose identifier is given, so the stack can go up before the
 * data plane and gain alarms as the other stacks are deployed.
 */
export interface ObservabilityConfig {
  envName: string;
  /** Public URL of the environment's edge (CloudFront or the API ALB) for the synthetic check. */
  edgeUrl?: string;
  /** Seconds of block age the synthetic check tolerates before failing. */
  maxBlockAgeSeconds: number;
  /**
   * Secrets Manager name of the canary's funded key, JSON {"privateKey": "0x..."}.
   * Present, the canary also submits a no-op transaction each run and records
   * its time to inclusion. Referenced by name; the value is read only by the
   * canary at run time.
   */
  canaryKeySecretName?: string;
  /** Seconds the canary waits for its transaction's receipt before failing. */
  maxInclusionSeconds: number;
  canaryGasLimit: number;
  /** Managed Prometheus (workspace, rules, alertmanager, metrics pipelines in the collectors). Off = traces only: the collectors ship spans to X-Ray and nothing else. */
  managedPrometheus: boolean;
  /** Managed Grafana workspace (needs IAM Identity Center or SAML). Off = read X-Ray and CloudWatch from another Grafana, e.g. the cell's. */
  managedGrafana: boolean;
  /**
   * Grafana as a Fargate service behind an existing load balancer (`-c grafanaService=true`), for an
   * account without Identity Center. Needs managedPrometheus, vpcId, grafanaPublicUrl,
   * grafanaAlbListenerArn and grafanaAlbSecurityGroupId.
   */
  grafanaService?: GrafanaServiceConfig;
  /** Grafana authentication: AWS_SSO (IAM Identity Center) or SAML. */
  grafanaAuth: "AWS_SSO" | "SAML";
  grafanaVersion: string;
  /** Aurora cluster identifier (data-plane stack) for replica lag and connection alarms. */
  auroraClusterIdentifier?: string;
  /** ALB full names (the `LoadBalancer` dimension, app/<name>/<id>) for 5xx ratio alarms. */
  albFullNames: string[];
  /** EC2 instance ids of the core cells for host alarms. */
  cellInstanceIds: string[];
}

function present(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

function ctx(app: App, key: string, fallback?: string): string {
  const v = app.node.tryGetContext(key);
  if (present(v)) return String(v);
  if (fallback === undefined) throw new Error(`missing context value: ${key} (pass -c ${key}=...)`);
  return fallback;
}

function optional(app: App, key: string): string | undefined {
  const v = app.node.tryGetContext(key);
  return present(v) ? String(v) : undefined;
}

function list(app: App, key: string): string[] {
  return ctx(app, key, "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(app: App): ObservabilityConfig {
  return {
    envName: ctx(app, "envName", "testnet"),
    edgeUrl: optional(app, "edgeUrl")?.replace(/\/$/, ""),
    maxBlockAgeSeconds: Number(ctx(app, "maxBlockAgeSeconds", "30")),
    canaryKeySecretName: optional(app, "canaryKeySecretName"),
    maxInclusionSeconds: Number(ctx(app, "maxInclusionSeconds", "30")),
    canaryGasLimit: Number(ctx(app, "canaryGasLimit", "1000000")),
    managedPrometheus: ctx(app, "managedPrometheus", "true") === "true",
    managedGrafana: ctx(app, "managedGrafana", "true") === "true",
    grafanaService:
      ctx(app, "grafanaService", "false") === "true"
        ? {
            vpcId: ctx(app, "vpcId"),
            publicUrl: ctx(app, "grafanaPublicUrl"),
            oauthSecretName: optional(app, "oauthSecretName"),
            adminGroups: list(app, "grafanaAdminGroups"),
            viewerGroups: list(app, "grafanaViewerGroups"),
            albListenerArn: ctx(app, "grafanaAlbListenerArn"),
            albSecurityGroupId: ctx(app, "grafanaAlbSecurityGroupId"),
            rulePriority: Number(ctx(app, "grafanaRulePriority", "9")),
            frontendLabels: optional(app, "frontendLabels"),
          }
        : undefined,
    grafanaAuth: ctx(app, "grafanaAuth", "AWS_SSO") as "AWS_SSO" | "SAML",
    grafanaVersion: ctx(app, "grafanaVersion", "10.4"),
    auroraClusterIdentifier: optional(app, "auroraClusterIdentifier"),
    albFullNames: list(app, "albFullNames"),
    cellInstanceIds: list(app, "cellInstanceIds"),
  };
}
