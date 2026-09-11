import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { AppTierConfig } from "./config";

export interface AppTierStackProps extends StackProps {
  vpc: ec2.IVpc;
  config: AppTierConfig;
}

/**
 * The stateless app tier: one Fargate task per copy running the app's nginx
 * (OAuth, CSRF, sessions) next to the backend, behind an ALB. The only state
 * is nginx's, kept in a small ElastiCache Redis that every copy shares.
 */
export class AppTierStack extends Stack {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly albUsesHttps: boolean;
  /** The ALB's one listener; other stacks add path rules to it. */
  readonly listener: elbv2.ApplicationListener;
  readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: AppTierStackProps) {
    super(scope, id, props);
    const { vpc, config } = props;
    const name = `strato-app-${config.envName}`;

    // --- Edge Redis: nginx sessions and CSRF tokens, shared by every copy ---
    const redisSg = new ec2.SecurityGroup(this, "RedisSg", { vpc, description: `${name} edge redis`, allowAllOutbound: false });
    const redisSubnets = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
      description: `${name} edge redis subnets`,
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
    });
    const redis = new elasticache.CfnReplicationGroup(this, "Redis", {
      replicationGroupDescription: `${name} edge redis (nginx sessions, CSRF tokens)`,
      engine: "redis",
      engineVersion: "7.1",
      cacheNodeType: "cache.t4g.micro",
      numCacheClusters: 2,
      automaticFailoverEnabled: true,
      multiAzEnabled: true,
      atRestEncryptionEnabled: true,
      // In-transit TLS would need lua-resty-session's redis SSL settings; the
      // group is reachable only from the tasks' security group.
      transitEncryptionEnabled: false,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSg.securityGroupId],
    });
    redis.addResourceDependency(redisSubnets);

    // --- Secrets: named here, resolved by ECS at task start ---
    const oauth = secretsmanager.Secret.fromSecretNameV2(this, "OauthSecret", config.secrets.oauth);
    const postgresPassword = secretsmanager.Secret.fromSecretNameV2(this, "PostgresPasswordSecret", config.secrets.postgresPassword);
    const session = secretsmanager.Secret.fromSecretNameV2(this, "SessionSecret", config.secrets.session);
    const backendSecret = config.secrets.backend
      ? secretsmanager.Secret.fromSecretNameV2(this, "BackendSecret", config.secrets.backend)
      : undefined;

    // --- ECS ---
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: name, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    this.cluster = cluster;
    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: `/strato/app/${config.envName}`, retention: logs.RetentionDays.ONE_MONTH });

    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 1024,
      memoryLimitMiB: 2048,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });

    const oauthEnv = {
      OAUTH_DISCOVERY_URL: ecs.Secret.fromSecretsManager(oauth, "discoveryUrl"),
      OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(oauth, "clientId"),
      OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(oauth, "clientSecret"),
    };

    const backend = task.addContainer("backend", {
      image: containerImage(this, "BackendRepo", config.backendImage),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "backend" }),
      portMappings: [{ containerPort: 3001 }],
      environment: {
        NODE_URL: config.nodeUrl,
        BASE_URL: config.domainName ? `https://${config.domainName}` : "",
        postgres_host: config.postgresHost,
        postgres_port: String(config.postgresPort),
        postgres_user: config.postgresUser,
        ...config.backendEnvironment,
      },
      secrets: {
        ...oauthEnv,
        postgres_password: ecs.Secret.fromSecretsManager(postgresPassword),
        ...(backendSecret ? backendSecretFields(backendSecret) : {}),
      },
      healthCheck: {
        command: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3001/api/v1/metrics > /dev/null || exit 1"],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(60),
      },
    });

    // nginx reaches the backend on localhost: Fargate tasks share a network
    // namespace, which is exactly the sidecar arrangement the node uses.
    const nginx = task.addContainer("nginx", {
      image: containerImage(this, "NginxRepo", config.nginxImage),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "nginx" }),
      portMappings: [{ containerPort: 80 }],
      environment: {
        NODE_URL: config.nodeUrl,
        DOCKERIZED_APP: "false",
        HOST_IP: "127.0.0.1",
        EDGE_REDIS_HOST: redis.attrPrimaryEndPointAddress,
        EDGE_REDIS_PORT: redis.attrPrimaryEndPointPort,
        // TLS terminates at CloudFront / the ALB; nginx itself speaks HTTP.
        ssl: "false",
      },
      secrets: {
        ...oauthEnv,
        SESSION_SECRET: ecs.Secret.fromSecretsManager(session),
      },
      healthCheck: {
        command: ["CMD-SHELL", "curl -sf http://127.0.0.1/_ping || exit 1"],
        interval: Duration.seconds(10),
        startPeriod: Duration.seconds(30),
      },
    });
    nginx.addContainerDependencies({ container: backend, condition: ecs.ContainerDependencyCondition.HEALTHY });

    // Observability sidecar (optional): the ADOT collector scrapes this task's
    // containers over localhost, forwards traces to X-Ray and remote-writes
    // metrics to Managed Prometheus. Config and policy come from the
    // observability app's outputs.
    if (config.otelConfigParameterName) {
      const otelConfig = ssm.StringParameter.fromStringParameterAttributes(this, "OtelConfigParam", {
        parameterName: config.otelConfigParameterName,
        forceDynamicReference: true,
      });
      task.addContainer("otel-collector", {
        image: ecs.ContainerImage.fromRegistry("public.ecr.aws/aws-observability/aws-otel-collector:v0.43.0"),
        logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "otel" }),
        essential: false,
        portMappings: [{ containerPort: 4317 }, { containerPort: 4318 }],
        secrets: { AOT_CONFIG_CONTENT: ecs.Secret.fromSsmParameter(otelConfig) },
        memoryReservationMiB: 256,
      });
      if (config.otelSidecarPolicyArn) {
        task.taskRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, "OtelSidecarPolicy", config.otelSidecarPolicyArn));
      }
      // The instrumented processes export spans to the sidecar over localhost.
      for (const containerName of ["strato-api", "nginx", "backend"]) {
        task.findContainer(containerName)?.addEnvironment("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318");
      }
    }

    const taskSg = new ec2.SecurityGroup(this, "TaskSg", { vpc, description: `${name} tasks` });
    redisSg.addIngressRule(taskSg, ec2.Port.tcp(6379), "nginx sessions and CSRF tokens");

    const service = new ecs.FargateService(this, "Service", {
      cluster,
      taskDefinition: task,
      desiredCount: config.desiredCount,
      securityGroups: [taskSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    service.autoScaleTaskCount({ minCapacity: config.desiredCount, maxCapacity: config.desiredCount * 4 })
      .scaleOnCpuUtilization("Cpu", { targetUtilizationPercent: 60 });

    // --- ALB ---
    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc, description: `${name} alb` });
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, "Alb", { vpc, internetFacing: true, securityGroup: albSg, loadBalancerName: name });
    this.albUsesHttps = Boolean(config.albCertificateArn);

    const listener = this.albUsesHttps
      ? this.loadBalancer.addListener("Https", {
          port: 443,
          certificates: [acm.Certificate.fromCertificateArn(this, "AlbCert", config.albCertificateArn!)],
          sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        })
      : this.loadBalancer.addListener("Http", { port: 80 });
    this.listener = listener;

    listener.addTargets("Nginx", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: "nginx", containerPort: 80 })],
      healthCheck: { path: "/_ping", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(15),
    });

    new CfnOutput(this, "AlbDnsName", { value: this.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, "TaskSecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Allow this group on the node's Postgres (5432) so the backend's cirrus pool can connect",
    });
    new CfnOutput(this, "RedisEndpoint", { value: `${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}` });
  }
}

/**
 * An ECR URI (`<account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>`) becomes
 * a repository reference so the task's execution role is granted pull access;
 * any other registry is used as-is (the node's own registry has no auth).
 */
function containerImage(scope: Construct, id: string, uri: string): ecs.ContainerImage {
  const m = uri.match(/^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([^:@]+)(?::([^@]+))?(?:@(sha256:[0-9a-f]+))?$/);
  if (!m) return ecs.ContainerImage.fromRegistry(uri);
  const [, account, region, repositoryName, tag, digest] = m;
  const repository = ecr.Repository.fromRepositoryAttributes(scope, id, {
    repositoryName,
    repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${repositoryName}`,
  });
  return digest
    ? ecs.ContainerImage.fromEcrRepository(repository, digest)
    : ecs.ContainerImage.fromEcrRepository(repository, tag ?? "latest");
}

/** Optional backend API keys, each a field of one JSON secret. */
function backendSecretFields(secret: secretsmanager.ISecret): Record<string, ecs.Secret> {
  const fields = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SENDGRID_API_KEY",
    "WAGMI_PROJECT_ID",
    "RPC_URL_MAINNET",
    "RPC_URL_MAINNET_FALLBACK",
    "RPC_URL_SEPOLIA",
    "RPC_URL_SEPOLIA_FALLBACK",
    "RPC_URL_BASE",
    "RPC_URL_BASE_FALLBACK",
    "RPC_URL_BASE_SEPOLIA",
    "RPC_URL_BASE_SEPOLIA_FALLBACK",
  ];
  return Object.fromEntries(fields.map((f) => [f, ecs.Secret.fromSecretsManager(secret, f)]));
}
