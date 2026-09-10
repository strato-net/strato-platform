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
 * The app history service (phase 7): prices, swaps and balances over time
 * in a Postgres cluster of its own, so chart queries never touch the chain
 * data's replicas. One Fargate service runs the two feeds (bus consumer and
 * Cirrus poller) and the chart API, reached through the app ALB under
 * /history-api. Aurora Serverless v2 scales with query load and pauses when
 * idle; the indexer keeps it warm in practice.
 */
export class HistoryStack extends Stack {
  constructor(scope: Construct, id: string, props: HistoryStackProps) {
    super(scope, id, props);
    const { vpc, config, cluster, listener } = props;
    const history = config.history!;
    const name = `strato-history-${config.envName}`;

    // --- Database: its own cluster, its own generated credentials ---
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
        postgres_host: db.clusterEndpoint.hostname,
        postgres_port: db.clusterEndpoint.port.toString(),
        postgres_user: "history",
        postgres_ssl: "require",
        HISTORY_DB_NAME: "history",
        // The cluster created the database; the service's user cannot.
        HISTORY_DB_CREATE: "false",
        BUS_HOST: busHost || "",
        BUS_PORT: busPort || "9096",
        BUS_SECURITY: history.busSecurity,
      },
      secrets: {
        postgres_password: ecs.Secret.fromSecretsManager(db.secret!, "password"),
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

    const taskSg = new ec2.SecurityGroup(this, "TaskSg", { vpc, description: `${name} tasks` });
    dbSg.addIngressRule(taskSg, ec2.Port.tcp(db.clusterEndpoint.port), "history service");

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

    new CfnOutput(this, "DbEndpoint", { value: db.clusterEndpoint.socketAddress });
    new CfnOutput(this, "DbSecretName", { value: db.secret!.secretName });
    new CfnOutput(this, "TaskSecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Allow this group on the message bus (9096) so the live feed can subscribe to chain_events",
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
