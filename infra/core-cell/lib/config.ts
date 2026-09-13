import { App } from "aws-cdk-lib";

/** Context contract for a core cell. Secrets are named, never valued. */
export interface CoreCellConfig {
  envName: string;
  /** Name of this core among the cores sharing the cluster (`--cellId`); also the peer store name. */
  cellId: string;
  /** The network's VPC (the validators' VPC on testnet), or empty to create one. */
  vpcId?: string;
  /** "public" (Elastic IP, reachable by peers) or "private" (dial-out only, behind the NAT). */
  subnetType: "public" | "private";
  instanceType: string;
  rootVolumeGiB: number;
  /** Separate gp3 volume for the node directory: LevelDB, Kafka and Redis state, logs. */
  dataVolumeGiB: number;
  /** SSM public parameter naming the AMI. Default: Canonical's Ubuntu 24.04, the strato image's base. */
  amiParameter: string;
  keyPairName?: string;
  /** ECR URI of the strato image (tag included); its binaries are extracted onto the host. */
  stratoImage: string;
  /** Registry prefix the generated compose pulls prometheus and streaming from (`--repoUrl`); derived from stratoImage. */
  repoUrl: string;
  /** Optional s3://bucket/prefix/ of extra binaries installed into /usr/local/bin (ones an older image lacks). */
  extraBinariesS3?: string;
  /** `--network` for strato-setup; the network definition carries the bootnodes and chain id. */
  network: string;
  /** Aurora endpoints (infra/data-plane outputs) and the master secret (JSON, "password" field). */
  postgresWriterHost: string;
  postgresReaderHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresSecretName: string;
  /** The Aurora cluster's security group (data-plane output ClusterSecurityGroupId): opened to this cell on the Postgres port at deploy time, so the first boot can reach it. */
  postgresSecurityGroupId?: string;
  /** "core" runs consensus, VM and indexers only; "node" also runs the app (nginx, app UI and backend, SMD, apex, PostgREST) on this host. */
  role: "core" | "node";
  /** With role node: a local OpenID provider instead of Keycloak (`--localAuth`); the admin password is generated on the host. */
  localAuth: boolean;
  /** Without localAuth: the Secrets Manager secret holding the node's OAuth client for the external provider (Keycloak), JSON {discoveryUrl, clientId, clientSecret}. The host writes it where strato-setup expects strato-login's output; the node key is then created in the shared vault under that client. */
  oauthSecretName?: string;
  /** A Grafana container on the host (port 3001, anonymous viewer) reading the node's own Prometheus, with the repo's dashboards. */
  grafana: boolean;
  /** Public hostname of the node: a Let's Encrypt certificate is obtained for it on the host (HTTP-01 on port 80), the machine hostname is set to it (the node URL derives from the hostname), and the node serves https. */
  tlsHostname?: string;
  letsEncryptEmail?: string;
  /** Who may reach the app (httpPort, 443) and Grafana (3001). */
  webCidrs: string[];
  /** The node's HTTP port (networkConfig.httpPort): nginx publishes it and 443. */
  httpPort: number;
  /** Per-cell peer store database on Postgres (`--peerDatabase`). Superseded by `peerStore: sqlite`, the default; only read when `peerStore` is `postgres`. */
  peerDatabase?: string;
  /** Where the cell keeps peers and sync tasks (`--peerStore`): `sqlite` (default; a file in the node directory, so networking does not depend on the cluster) or `postgres`. */
  peerStore: "sqlite" | "postgres";
  /** Writer lease and consensus role of this cell (design-documents/standby-core.md). */
  writer: boolean;
  validatorBehavior: boolean;
  /** Run vm-query on the cell (only useful when the cell also serves RPC). */
  vmQuery: boolean;
  /** Snapshot to restore on first boot: an s3:// URI or a published timestamp ("latest"). */
  snapshotSource?: string;
  snapshotBucket?: string;
  /** Extra strato-setup flags appended verbatim on first boot (for example --vaultUrl=...). */
  extraSetupFlags: string;
  /** With role node: run the app (app-ui, app-backend) on this host (`--bundledApp`). false when the app tier serves it; the node's root then redirects to `appUrl`. */
  bundledApp: boolean;
  appUrl?: string;
  /** With role node: run the SMD on this host (`--bundledSmd`). false when it is served from S3 behind CloudFront; the node's /smd then redirects to `smdUrl`. */
  bundledSmd: boolean;
  smdUrl?: string;
  /** With role node: run PostgREST (the Cirrus API at /cirrus) on this host (`--bundledPostgrest`). false when the API tier serves Cirrus. */
  bundledPostgrest: boolean;
  /** Names for the tier map's CloudFront distributions in the host Grafana (`E123ABC=SMD,E456DEF=App UI`). */
  frontendLabels?: string;
  /** Who may reach the p2p port (30303 tcp/udp). */
  p2pCidrs: string[];
  /** Security groups allowed on the cell's Kafka listener (9094) and its API ports: the API tier's task SG. */
  clientSecurityGroupIds: string[];
  /** SSH from a bastion's security group, or nothing (SSM Session Manager always works). */
  sshSourceSecurityGroupId?: string;
  /** Observability (optional): the collector configs the observability app published and its Prometheus workspace. */
  otelConfigParameterName?: string;
  cloudWatchAgentParameterName?: string;
  prometheusWorkspaceArn?: string;
  /** Secrets Manager names the host may create or update (to publish the node's OAuth client credentials for the API and app tiers). */
  publishSecretNames: string[];
  terminationProtection: boolean;
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
function list(app: App, key: string, fallback: string): string[] {
  return String(ctx(app, key, fallback)).split(",").map((s) => s.trim()).filter(Boolean);
}
function bool(app: App, key: string, fallback: string): boolean {
  return String(ctx(app, key, fallback)) === "true";
}
function peerStore(app: App): "sqlite" | "postgres" {
  const value = String(ctx(app, "peerStore", "sqlite"));
  if (value !== "sqlite" && value !== "postgres") throw new Error(`peerStore must be sqlite or postgres, not ${value}`);
  return value;
}

export function loadConfig(app: App): CoreCellConfig {
  const envName = ctx(app, "envName", "testnet");
  const cellId = ctx<string>(app, "cellId");
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(cellId)) throw new Error(`cellId must be a short lowercase name, got ${cellId}`);
  const stratoImage = ctx<string>(app, "stratoImage");
  const subnetType = ctx(app, "subnetType", "public");
  if (subnetType !== "public" && subnetType !== "private") throw new Error(`subnetType must be public or private, got ${subnetType}`);
  const writerHost = ctx<string>(app, "postgresWriterHost");
  const role = ctx(app, "role", "core");
  if (role !== "core" && role !== "node") throw new Error(`role must be core or node, got ${role}`);
  return {
    envName,
    cellId,
    vpcId: optional(app, "vpcId"),
    subnetType,
    instanceType: ctx(app, "instanceType", "m6i.xlarge"),
    rootVolumeGiB: Number(ctx(app, "rootVolumeGiB", "40")),
    dataVolumeGiB: Number(ctx(app, "dataVolumeGiB", "200")),
    amiParameter: ctx(app, "amiParameter", "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"),
    keyPairName: optional(app, "keyPairName"),
    stratoImage,
    repoUrl: ctx(app, "repoUrl", stratoImage.slice(0, stratoImage.lastIndexOf("/") + 1)),
    extraBinariesS3: optional(app, "extraBinariesS3"),
    network: ctx(app, "network", "upquark"),
    postgresWriterHost: writerHost,
    postgresReaderHost: ctx(app, "postgresReaderHost", writerHost),
    postgresPort: Number(ctx(app, "postgresPort", "5432")),
    postgresUser: ctx(app, "postgresUser", "postgres"),
    postgresSecretName: ctx(app, "postgresSecretName", `strato/${envName}/postgres`),
    postgresSecurityGroupId: optional(app, "postgresSecurityGroupId"),
    role,
    localAuth: bool(app, "localAuth", "false"),
    oauthSecretName: optional(app, "oauthSecretName"),
    grafana: bool(app, "grafana", "false"),
    tlsHostname: optional(app, "tlsHostname"),
    letsEncryptEmail: optional(app, "letsEncryptEmail"),
    webCidrs: list(app, "webCidrs", "0.0.0.0/0"),
    httpPort: Number(ctx(app, "httpPort", "8081")),
    peerDatabase: optional(app, "peerDatabase"),
    peerStore: peerStore(app),
    writer: bool(app, "writer", "false"),
    validatorBehavior: bool(app, "validatorBehavior", "false"),
    vmQuery: bool(app, "vmQuery", "false"),
    snapshotSource: optional(app, "snapshotSource"),
    snapshotBucket: optional(app, "snapshotBucket"),
    extraSetupFlags: String(ctx(app, "extraSetupFlags", "")),
    bundledApp: bool(app, "bundledApp", "true"),
    appUrl: optional(app, "appUrl"),
    bundledSmd: bool(app, "bundledSmd", "true"),
    smdUrl: optional(app, "smdUrl"),
    bundledPostgrest: bool(app, "bundledPostgrest", "true"),
    frontendLabels: optional(app, "frontendLabels"),
    p2pCidrs: list(app, "p2pCidrs", "0.0.0.0/0"),
    clientSecurityGroupIds: list(app, "clientSecurityGroupIds", ""),
    sshSourceSecurityGroupId: optional(app, "sshSourceSecurityGroupId"),
    otelConfigParameterName: optional(app, "otelConfigParameterName"),
    cloudWatchAgentParameterName: optional(app, "cloudWatchAgentParameterName"),
    prometheusWorkspaceArn: optional(app, "prometheusWorkspaceArn"),
    publishSecretNames: list(app, "publishSecretNames", ""),
    terminationProtection: bool(app, "terminationProtection", "true"),
  };
}
