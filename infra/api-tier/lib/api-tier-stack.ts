import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { ApiTierConfig } from "./config";

export interface ApiTierStackProps extends StackProps {
  vpc: ec2.IVpc;
  config: ApiTierConfig;
}

/**
 * The STRATO API tier: one Fargate task per copy running the node's nginx as
 * a sidecar in front of strato-api + ethereum-jsonrpc (the strato image's
 * api-doit.sh entrypoint), PostgREST for Cirrus, and the SMD and apex
 * containers the SMD needs, behind an ALB. Shared state lives in a small
 * ElastiCache Redis: nonce counters for bloc, CSRF tokens and sessions for
 * nginx. Reads go to the Aurora reader endpoint, writes and the resolve poll
 * to the writer, and transactions and VM calls to the core's VPC-facing
 * Kafka listener until the message bus exists.
 */
export class ApiTierStack extends Stack {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApiTierStackProps) {
    super(scope, id, props);
    const { vpc, config } = props;
    const name = `strato-api-${config.envName}`;

    // --- Edge Redis ---
    const redisSg = new ec2.SecurityGroup(this, "RedisSg", { vpc, description: `${name} edge redis`, allowAllOutbound: false });
    const redisSubnets = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
      description: `${name} edge redis subnets`,
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds,
    });
    const redis = new elasticache.CfnReplicationGroup(this, "Redis", {
      replicationGroupDescription: `${name} edge redis (nonces, CSRF tokens, sessions)`,
      engine: "redis",
      engineVersion: "7.1",
      cacheNodeType: "cache.t4g.micro",
      numCacheClusters: 2,
      automaticFailoverEnabled: true,
      multiAzEnabled: true,
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: false,
      cacheSubnetGroupName: redisSubnets.ref,
      securityGroupIds: [redisSg.securityGroupId],
    });
    redis.addResourceDependency(redisSubnets);

    // --- Secrets and the node config ---
    const postgres = secretsmanager.Secret.fromSecretNameV2(this, "PostgresSecret", config.secrets.postgres);
    const oauthYaml = secretsmanager.Secret.fromSecretNameV2(this, "OauthYamlSecret", config.secrets.oauthCredentialsYaml);
    const session = secretsmanager.Secret.fromSecretNameV2(this, "SessionSecret", config.secrets.session);
    const ethconf = ssm.StringParameter.fromStringParameterAttributes(this, "EthconfParam", {
      parameterName: config.ethconfParameterName,
      // Read at task start by ECS, not at synth: the value is the node's
      // whole config and changes with every re-setup of the node.
      forceDynamicReference: true,
    });
    const ethconfEnv = { ETHCONF_BASE64: ecs.Secret.fromSsmParameter(ethconf) };

    // --- ECS ---
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: name, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: `/strato/api/${config.envName}`, retention: logs.RetentionDays.ONE_MONTH });
    const task = new ecs.FargateTaskDefinition(this, "Task", {
      cpu: 2048,
      memoryLimitMiB: 4096,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const image = (id: string, uri: string) => containerImage(this, id, uri);
    const awsLogs = (prefix: string) => ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: prefix });

    // strato-api + ethereum-jsonrpc. The OAuth credentials file is handed
    // over whole as a secret; api-doit.sh writes it where strato-auth reads.
    const api = task.addContainer("strato-api", {
      image: image("StratoRepo", config.stratoImage),
      entryPoint: ["/strato/api-doit.sh"],
      logging: awsLogs("strato-api"),
      portMappings: [{ containerPort: 3000 }, { containerPort: 8545 }],
      environment: {
        postgres_host: config.postgresWriterHost,
        postgres_reader_host: config.postgresReaderHost,
        postgres_port: String(config.postgresPort),
        postgres_user: config.postgresUser,
        kafkaHost: config.kafkaHost,
        kafkaPort: String(config.kafkaPort),
        EDGE_REDIS_HOST: redis.attrPrimaryEndPointAddress,
        EDGE_REDIS_PORT: redis.attrPrimaryEndPointPort,
      },
      secrets: {
        ...ethconfEnv,
        postgres_password: ecs.Secret.fromSecretsManager(postgres, "password"),
        OAUTH_CREDENTIALS_YAML: ecs.Secret.fromSecretsManager(oauthYaml),
      },
      healthCheck: {
        command: ["CMD-SHELL", "pgrep strato-api && pgrep ethereum-jsonrpc || exit 1"],
        interval: Duration.seconds(15),
        startPeriod: Duration.seconds(90),
      },
    });

    task.addContainer("postgrest", {
      image: image("PostgrestRepo", config.postgrestImage),
      logging: awsLogs("postgrest"),
      portMappings: [{ containerPort: 3001 }],
      environment: {
        PG_ENV_POSTGRES_DB: "cirrus",
        PG_ENV_POSTGRES_HOST: config.postgresReaderHost,
        PG_ENV_POSTGRES_USER: config.postgresUser,
        PG_PORT_5432_TCP_PORT: String(config.postgresPort),
        POSTGREST_LOG_LEVEL: "error",
        POSTGREST_SCHEMA_RELOAD_SECONDS: "30",
      },
      secrets: { PG_ENV_POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(postgres, "password") },
    });

    // SMD and apex ride along so the SMD keeps working through the cutover;
    // apex here serves key creation for the SMD, its node-health views point
    // at the public node URL from the config.
    const smd = config.smdImage
      ? task.addContainer("smd", {
          image: image("SmdRepo", config.smdImage),
          logging: awsLogs("smd"),
          portMappings: [{ containerPort: 3002 }],
          secrets: ethconfEnv,
        })
      : undefined;
    const apex = config.apexImage
      ? task.addContainer("apex", {
          image: image("ApexRepo", config.apexImage),
          logging: awsLogs("apex"),
          portMappings: [{ containerPort: 3009 }],
          environment: {
            postgres_host: config.postgresWriterHost,
            postgres_port: String(config.postgresPort),
            postgres_user: config.postgresUser,
            PROMETHEUS_HOST: "127.0.0.1:1",
          },
          secrets: { ...ethconfEnv, postgres_password: ecs.Secret.fromSecretsManager(postgres, "password") },
        })
      : undefined;

    const nginx = task.addContainer("nginx", {
      image: image("NginxRepo", config.nginxImage),
      logging: awsLogs("nginx"),
      portMappings: [{ containerPort: config.httpPort }],
      environment: {
        API_UPSTREAM_HOST: "127.0.0.1",
        STRATO_PORT_API: "3000",
        RPC_PORT: "8545",
        JSONRPC_ENABLED: "true",
        POSTGREST_HOST: "127.0.0.1:3001",
        SMD_HOST: smd ? "127.0.0.1:3002" : "127.0.0.1:1",
        APEX_HOST: apex ? "127.0.0.1:3009" : "127.0.0.1:1",
        DOCS_HOST: "127.0.0.1:1",
        PROMETHEUS_HOST: "127.0.0.1:1",
        BUNDLED_APP: "false",
        EDGE_REDIS_HOST: redis.attrPrimaryEndPointAddress,
        EDGE_REDIS_PORT: redis.attrPrimaryEndPointPort,
        ssl: "false",
      },
      secrets: {
        ...ethconfEnv,
        SESSION_SECRET: ecs.Secret.fromSecretsManager(session),
        OAUTH_CREDENTIALS_YAML: ecs.Secret.fromSecretsManager(oauthYaml),
      },
      healthCheck: {
        command: ["CMD-SHELL", `curl -sf http://127.0.0.1:${config.httpPort}/_ping || exit 1`],
        interval: Duration.seconds(10),
        startPeriod: Duration.seconds(60),
      },
    });
    nginx.addContainerDependencies({ container: api, condition: ecs.ContainerDependencyCondition.HEALTHY });

    const taskSg = new ec2.SecurityGroup(this, "TaskSg", { vpc, description: `${name} tasks` });
    redisSg.addIngressRule(taskSg, ec2.Port.tcp(6379), "nonces, CSRF tokens, sessions");

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
    const listener = config.albCertificateArn
      ? this.loadBalancer.addListener("Https", {
          port: 443,
          certificates: [acm.Certificate.fromCertificateArn(this, "AlbCert", config.albCertificateArn)],
          sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        })
      : this.loadBalancer.addListener("Http", { port: 80 });
    listener.addTargets("Nginx", {
      port: config.httpPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: "nginx", containerPort: config.httpPort })],
      healthCheck: { path: "/_ping", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });
    if (config.albCertificateArn) {
      this.loadBalancer.addListener("HttpRedirect", { port: 80, defaultAction: elbv2.ListenerAction.redirect({ port: "443", protocol: "HTTPS", permanent: true }) });
    }

    // --- Weighted cutover on the node hostname ---
    // Two weighted records with the same name: the node(s) and this tier.
    // Start with apiTierWeight=10, raise it as the validation queries stay
    // clean, finish at 100; rollback is the same number going down.
    if (config.hostedZoneId && config.domainName) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
        hostedZoneId: config.hostedZoneId,
        zoneName: config.domainName.split(".").slice(1).join("."),
      });
      new route53.ARecord(this, "ApiTierRecord", {
        zone,
        recordName: config.domainName,
        target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(this.loadBalancer)),
        weight: config.apiTierWeight,
        setIdentifier: "api-tier",
      });
      if (config.nodeIpAddresses.length > 0) {
        new route53.ARecord(this, "NodeRecord", {
          zone,
          recordName: config.domainName,
          target: route53.RecordTarget.fromIpAddresses(...config.nodeIpAddresses),
          weight: 100 - config.apiTierWeight,
          setIdentifier: "node",
          ttl: Duration.seconds(60),
        });
      }
    }

    new CfnOutput(this, "AlbDnsName", { value: this.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, "TaskSecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Allow on the Aurora cluster (5432) and the core host's Kafka external listener (9094)",
    });
    new CfnOutput(this, "RedisEndpoint", { value: `${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}` });
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
