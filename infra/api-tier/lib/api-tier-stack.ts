import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { InstanceIdTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { ApiTierConfig } from "./config";

export interface ApiTierStackProps extends StackProps {
  /** Certificate for the ALB's HTTPS listener (from CertificateStack); `config.albCertificateArn` otherwise. */
  albCertificate?: acm.ICertificate;
  /** More hostnames the HTTPS listener answers for: the SMD's, which CloudFront forwards with the viewer's Host header and so needs a matching certificate here. */
  extraCertificates?: acm.ICertificate[];
  vpc: ec2.IVpc;
  config: ApiTierConfig;
}

/**
 * The STRATO API tier: one Fargate task per copy running the node's nginx as
 * a sidecar in front of strato-api + ethereum-jsonrpc (the strato image's
 * api-doit.sh entrypoint), PostgREST for Cirrus, and the SMD and apex
 * containers the SMD needs, behind an ALB. There is no shared edge state:
 * sessions ride in the encrypted cookie, CSRF tokens stay per instance behind
 * ALB session stickiness, and nonce counters live in Aurora's writer. Until
 * the message bus exists, transactions go to the core's Kafka listener.
 */
export class ApiTierStack extends Stack {
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApiTierStackProps) {
    super(scope, id, props);
    const { vpc, config } = props;
    const name = `strato-api-${config.envName}`;

    // --- Secrets and the node config ---
    const postgres = secretsmanager.Secret.fromSecretNameV2(this, "PostgresSecret", config.secrets.postgres);
    // Either the credentials file as one secret, or a JSON secret whose three fields both
    // strato-api and nginx take as OAUTH_* variables (see oauthJsonSecretName).
    const oauthJson = config.oauthJsonSecretName
      ? (config.oauthJsonSecretName.startsWith("arn:")
          ? secretsmanager.Secret.fromSecretCompleteArn(this, "OauthJsonSecret", config.oauthJsonSecretName)
          : secretsmanager.Secret.fromSecretNameV2(this, "OauthJsonSecret", config.oauthJsonSecretName))
      : undefined;
    const oauthYaml = oauthJson ? undefined : secretsmanager.Secret.fromSecretNameV2(this, "OauthYamlSecret", config.secrets.oauthCredentialsYaml);
    const oauthFields = (secret: secretsmanager.ISecret) => ({
      OAUTH_DISCOVERY_URL: ecs.Secret.fromSecretsManager(secret, "discoveryUrl"),
      OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(secret, "clientId"),
      OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(secret, "clientSecret"),
    });
    const session: secretsmanager.ISecret = config.createSessionSecret
      ? new secretsmanager.Secret(this, "SessionSecret", {
          secretName: config.secrets.session,
          description: `${name} nginx session secret`,
          generateSecretString: { passwordLength: 64, excludePunctuation: true },
        })
      : secretsmanager.Secret.fromSecretNameV2(this, "SessionSecret", config.secrets.session);
    // nginx's session secret, when it is not this stack's own (front door: the app tier's).
    // A complete ARN is required when the name ends in "-" and six characters (as
    // strato/app/session-secret does): Secrets Manager reads that ending of a
    // name-only reference as the random suffix, finds no such secret, and ECS's
    // fetch fails as AccessDenied.
    const nginxSession = !config.nginxSessionSecretName
      ? session
      : config.nginxSessionSecretName.startsWith("arn:")
        ? secretsmanager.Secret.fromSecretCompleteArn(this, "NginxSessionSecret", config.nginxSessionSecretName)
        : secretsmanager.Secret.fromSecretNameV2(this, "NginxSessionSecret", config.nginxSessionSecretName);
    // nginx's login client, when it differs from the node's (front door: shared with the app tier).
    const nginxOauth = config.nginxOauthSecretName ? secretsmanager.Secret.fromSecretNameV2(this, "NginxOauthSecret", config.nginxOauthSecretName) : undefined;
    // MSK SASL/SCRAM secret: JSON {username, password}, name prefixed AmazonMSK_.
    const busSecret = config.busHost ? secretsmanager.Secret.fromSecretNameV2(this, "BusSecret", config.busSecretName) : undefined;
    const ethconf = ssm.StringParameter.fromStringParameterAttributes(this, "EthconfParam", {
      parameterName: config.ethconfParameterName,
      // Read at task start by ECS, not at synth: the value is the node's
      // whole config and changes with every re-setup of the node.
      forceDynamicReference: true,
    });
    const ethconfEnv = { ETHCONF_BASE64: ecs.Secret.fromSsmParameter(ethconf) };

    // --- ECS ---
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: name, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    // DESTROY, not the CDK default of RETAIN: a retained group keeps its name,
    // and the next create of this stack then fails with "already exists".
    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: `/strato/api/${config.envName}`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
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
        VM_QUERY: config.vmQuery ? "true" : "false",

        ...(config.vaultUrl ? { VAULT_URL: config.vaultUrl } : {}),
        ...(config.busHost
          ? { BUS_HOST: config.busHost, BUS_PORT: String(config.busPort), BUS_SECURITY: "sasl_ssl", BUS_SUBMIT_MODE: config.busSubmitMode }
          : {}),
      },
      secrets: {
        ...ethconfEnv,
        postgres_password: ecs.Secret.fromSecretsManager(postgres, "password"),
        ...(oauthYaml ? { OAUTH_CREDENTIALS_YAML: ecs.Secret.fromSecretsManager(oauthYaml) } : oauthFields(oauthJson!)),
        ...(busSecret
          ? { BUS_SASL_USERNAME: ecs.Secret.fromSecretsManager(busSecret, "username"), BUS_SASL_PASSWORD: ecs.Secret.fromSecretsManager(busSecret, "password") }
          : {}),
      },
      healthCheck: {
        command: ["CMD-SHELL", "pgrep -f '^strato-api' && pgrep -f '^ethereum-jsonrpc' || exit 1"],
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
            // The node's metrics live in a core cell's Prometheus (-c prometheusHost). strato-api
            // runs in this task, so apex calls it locally and its health_check is not among the
            // cell's jobs: the required jobs leave core-api out.
            PROMETHEUS_HOST: config.prometheusHost ?? "127.0.0.1:1",
            // apex would otherwise call strato-api at the node URL's host (the front door).
            APEX_STRATO_API_HOST: "127.0.0.1",
            APEX_STRATO_API_PORT: "3000",
            ...(config.prometheusHost
              ? { HEALTH_CHECK_JOBS: "slipstream_main=slipstream,strato_p2p=strato-p2p,vm_main=vm-runner,seq_main=strato-sequencer" }
              : {}),
          },
          secrets: { ...ethconfEnv, postgres_password: ecs.Secret.fromSecretsManager(postgres, "password") },
        })
      : undefined;

    // The API docs: Swagger UI, served at /docs/ by the nginx sidecar, which
    // also serves the spec and the initializer from its own image. Not
    // essential, so a docs failure never takes the API down.
    const docs = config.docsImage
      ? task.addContainer("docs", {
          image: image("DocsRepo", config.docsImage),
          logging: awsLogs("docs"),
          portMappings: [{ containerPort: 8080 }],
          environment: { API_URL: "/docs/swagger.yaml" },
          essential: false,
          memoryReservationMiB: 64,
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
        DOCS_HOST: docs ? "127.0.0.1:8080" : "127.0.0.1:1",
        PROMETHEUS_HOST: "127.0.0.1:1",
        BUNDLED_APP: "false",
        ssl: "false",
        // TLS ends at the ALB (or CloudFront): the OpenID redirect goes back over https.
        ...(props.albCertificate || config.albCertificateArn ? { PUBLIC_SCHEME: "https" } : {}),
        ...(config.csrfStateless ? { CSRF_STATELESS: "true" } : {}),
      },
      secrets: {
        ...ethconfEnv,
        SESSION_SECRET: ecs.Secret.fromSecretsManager(nginxSession),
        ...(oauthYaml ? { OAUTH_CREDENTIALS_YAML: ecs.Secret.fromSecretsManager(oauthYaml) } : {}),
        // docker-run.sh prefers these over the credentials file's client.
        ...(nginxOauth || oauthJson
          ? oauthFields((nginxOauth ?? oauthJson)!)
          : {}),
      },
      healthCheck: {
        command: ["CMD-SHELL", `curl -sf http://127.0.0.1:${config.httpPort}/_ping || exit 1`],
        interval: Duration.seconds(10),
        startPeriod: Duration.seconds(60),
      },
    });
    nginx.addContainerDependencies({ container: api, condition: ecs.ContainerDependencyCondition.HEALTHY });

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
    if (config.postgresSecurityGroupId) {
      ec2.SecurityGroup.fromSecurityGroupId(this, "ClusterSg", config.postgresSecurityGroupId).addIngressRule(taskSg, ec2.Port.tcp(config.postgresPort), `${name} tasks`);
    }
    const coreSg = config.coreSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(this, "CoreSg", config.coreSecurityGroupId)
      : undefined;
    if (coreSg) {
      const core = coreSg;
      core.addIngressRule(taskSg, ec2.Port.tcp(config.kafkaPort), `${name} tasks: Kafka`);
      core.addIngressRule(taskSg, ec2.Port.tcp(3000), `${name} tasks: strato-api`);
      core.addIngressRule(taskSg, ec2.Port.tcp(8545), `${name} tasks: jsonrpc`);
      core.addIngressRule(taskSg, ec2.Port.tcp(8093), `${name} tasks: vault wrapper`);
      if (config.prometheusHost) {
        const port = Number(config.prometheusHost.split(":")[1] ?? "9090");
        core.addIngressRule(taskSg, ec2.Port.tcp(port), `${name} tasks: Prometheus (apex health)`);
      }
    }

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
    const albCertificate =
      props.albCertificate ?? (config.albCertificateArn ? acm.Certificate.fromCertificateArn(this, "AlbCert", config.albCertificateArn) : undefined);
    // The port-80 listener keeps one logical id whether it forwards (no
    // certificate) or redirects to 443: two listeners on one port cannot
    // coexist, so switching to HTTPS must update it in place. The service moves
    // to the HTTPS listener's target group in place too.
    const http = this.loadBalancer.addListener("Http", {
      port: 80,
      ...(albCertificate ? { defaultAction: elbv2.ListenerAction.redirect({ port: "443", protocol: "HTTPS", permanent: true }) } : {}),
    });
    const listener = albCertificate
      ? this.loadBalancer.addListener("Https", {
          port: 443,
          certificates: [albCertificate],
          sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        })
      : http;
    const extraCertificates = [
      ...(props.extraCertificates ?? []).map((c) => elbv2.ListenerCertificate.fromCertificateManager(c)),
      // CloudFront forwards the front door's Host header, so this ALB must serve its certificate.
      // Skipped when the listener already serves it as its default certificate.
      ...(config.frontDoorCertificateArn && config.frontDoorCertificateArn !== config.albCertificateArn
        ? [elbv2.ListenerCertificate.fromArn(config.frontDoorCertificateArn)]
        : []),
    ];
    if (albCertificate && extraCertificates.length) {
      listener.addCertificates("ExtraCertificates", extraCertificates);
    }
    listener.addTargets("Nginx", {
      port: config.httpPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: "nginx", containerPort: config.httpPort })],
      healthCheck: { path: "/_ping", interval: Duration.seconds(15), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
      // A browser stays on the instance that issued its CSRF token (kept in
      // that nginx's shared dict); sessions themselves are in the cookie, so
      // a re-pin after a deploy only costs one CSRF refresh.
      stickinessCookieDuration: Duration.days(1),
    });

    // --- Grafana on a core cell, reached through this ALB ---
    // Grafana runs on the cell, not in this tier, and the only public name in
    // front of it is the front door, so /grafana* comes in over CloudFront,
    // lands here and is forwarded to the instance. Grafana itself does the
    // Keycloak login (generic_oauth) and refuses anyone outside the whitelisted
    // group, so this rule is routing only - it is not the access control. The
    // cell's 3001 stays shut to everything except this load balancer.
    if (config.grafanaInstanceId) {
      const grafanaTargets = new elbv2.ApplicationTargetGroup(this, "GrafanaTargets", {
        vpc,
        port: config.grafanaPort,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.INSTANCE,
        targets: [new InstanceIdTarget(config.grafanaInstanceId, config.grafanaPort)],
        // Served under the sub path, so the health endpoint is under it too.
        healthCheck: { path: "/grafana/api/health", interval: Duration.seconds(30), healthyThresholdCount: 2 },
        deregistrationDelay: Duration.seconds(30),
      });
      listener.addTargetGroups("Grafana", {
        priority: 10,
        conditions: [elbv2.ListenerCondition.pathPatterns(["/grafana", "/grafana/*"])],
        targetGroups: [grafanaTargets],
      });
      coreSg?.addIngressRule(albSg, ec2.Port.tcp(config.grafanaPort), `${name} alb: Grafana`);
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
    if (config.domainName && !config.hostedZoneId) {
      new CfnOutput(this, "HostnameRecord", {
        value: `${config.domainName} CNAME ${this.loadBalancer.loadBalancerDnsName}`,
        description: "The record to create at the registrar for the tier's hostname",
      });
    }
    new CfnOutput(this, "TaskSecurityGroupId", {
      value: taskSg.securityGroupId,
      description: "Allow on the Aurora cluster (5432) and the core host's Kafka external listener (9094)",
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
