import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { AppTierConfig } from "./config";

export interface HistoryStackProps extends StackProps {
  vpc: ec2.IVpc;
  config: AppTierConfig;
  cluster: ecs.ICluster;
  listener: elbv2.ApplicationListener;
}

/**
 * The app history service (phase 7): prices, swaps and balances over time.
 * One Fargate service runs the feeds (the Cirrus poller, and the bus consumer
 * when a bus is configured) and the chart API, reached through the app ALB
 * under /history-api.
 *
 * Its tables live in a `history` database on an existing cluster when the
 * config names one (the chain's Aurora cluster: one cluster to run and back
 * up, and the history writes are small against it), which the service
 * creates itself at start. Without one, the stack creates an Aurora
 * Serverless v2 cluster of its own, so chart queries never touch the chain
 * data's replicas; split to that once chart load shows in their metrics.
 */
export class HistoryStack extends Stack {
  constructor(scope: Construct, id: string, props: HistoryStackProps) {
    super(scope, id, props);
    const { vpc, config, cluster, listener } = props;
    const history = config.history!;
    const name = `strato-history-${config.envName}`;

    const taskSg = new ec2.SecurityGroup(this, "TaskSg", { vpc, description: `${name} tasks` });

    // --- Database: a database on an existing cluster, or a cluster of its own ---
    let dbHost: string;
    let dbPort: string;
    let dbUser: string;
    let dbSecret: secretsmanager.ISecret;
    let dbCreate: string;
    let dbDescription: string;
    if (history.database) {
      const existing = history.database;
      dbHost = existing.host;
      dbPort = String(existing.port);
      dbUser = existing.user;
      dbSecret = secretsmanager.Secret.fromSecretNameV2(this, "DbSecret", existing.secretName);
      // The service creates its database through the maintenance database.
      dbCreate = "true";
      dbDescription = `history database on ${existing.host}`;
      if (existing.securityGroupId) {
        const clusterSg = ec2.SecurityGroup.fromSecurityGroupId(this, "ClusterSg", existing.securityGroupId);
        clusterSg.addIngressRule(taskSg, ec2.Port.tcp(existing.port), "history service");
      }
    } else {
      const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc, description: `${name} postgres`, allowAllOutbound: false });
      const db = new rds.DatabaseCluster(this, "Db", {
        engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_10 }),
        clusterIdentifier: name,
        credentials: rds.Credentials.fromGeneratedSecret("history", { secretName: `${name}/postgres` }),
        defaultDatabaseName: "history",
        writer: rds.ClusterInstance.serverlessV2("Writer"),
        serverlessV2MinCapacity: 0.5,
        serverlessV2MaxCapacity: 8,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [dbSg],
        storageEncrypted: true,
        backup: { retention: Duration.days(14) },
        deletionProtection: true,
        removalPolicy: RemovalPolicy.RETAIN,
      });
      dbSg.addIngressRule(taskSg, ec2.Port.tcp(db.clusterEndpoint.port), "history service");
      dbHost = db.clusterEndpoint.hostname;
      dbPort = db.clusterEndpoint.port.toString();
      dbUser = "history";
      dbSecret = db.secret!;
      // The cluster created the database; the service's user cannot.
      dbCreate = "false";
      dbDescription = db.clusterEndpoint.socketAddress;
    }

    // --- Service ---
    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: `/strato/history/${config.envName}`, retention: logs.RetentionDays.ONE_MONTH });
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });

    const busSecret = history.busSecretName
      ? secretsmanager.Secret.fromSecretNameV2(this, "BusSecret", history.busSecretName)
      : undefined;
    const [busHost, busPort] = (history.busBootstrap || "").split(":");

    task.addContainer("history", {
      image: containerImage(this, "HistoryRepo", history.image),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "history" }),
      portMappings: [{ containerPort: 3030 }],
      environment: {
        PORT: "3030",
        NODE_URL: config.nodeUrl,
        postgres_host: dbHost,
        postgres_port: dbPort,
        postgres_user: dbUser,
        postgres_ssl: "require",
        HISTORY_DB_NAME: "history",
        HISTORY_DB_CREATE: dbCreate,
        BUS_HOST: busHost || "",
        BUS_PORT: busPort || "9096",
        BUS_SECURITY: history.busSecurity,
      },
      secrets: {
        postgres_password: ecs.Secret.fromSecretsManager(dbSecret, "password"),
        ...(busSecret
          ? {
              BUS_SASL_USERNAME: ecs.Secret.fromSecretsManager(busSecret, "username"),
              BUS_SASL_PASSWORD: ecs.Secret.fromSecretsManager(busSecret, "password"),
            }
          : {}),
      },
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3030/history-api/health > /dev/null || exit 1"],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(60),
      },
    });

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: task,
      desiredCount: history.desiredCount,
      securityGroups: [taskSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    // --- Routed by path on the app ALB, ahead of the default nginx target ---
    listener.addTargets("History", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/history-api/*"])],
      port: 3030,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: "history", containerPort: 3030 })],
      healthCheck: { path: "/history-api/health", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(15),
    });

    new CfnOutput(this, "Database", { value: dbDescription });
    new CfnOutput(this, "DbSecretName", { value: dbSecret.secretName });
    new CfnOutput(this, "TaskSecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Allow this group on the database cluster (when not done by the stack) and on the message bus (9096) if the live feed is used",
    });
  }
}

function containerImage(scope: Construct, id: string, uri: string): ecs.ContainerImage {
  const m = uri.match(/^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([^:@]+)(?::([^@]+))?(?:@(sha256:[0-9a-f]+))?$/);
  if (!m) return ecs.ContainerImage.fromRegistry(uri);
  const [, account, region, repositoryName, tag, digest] = m;
  const repository = ecr.Repository.fromRepositoryAttributes(scope, id, {
    repositoryName,
    repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${repositoryName}`,
  });
  return digest ? ecs.ContainerImage.fromEcrRepository(repository, digest) : ecs.ContainerImage.fromEcrRepository(repository, tag ?? "latest");
}
