import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as aps from "aws-cdk-lib/aws-aps";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";
import { deploymentPrefix, elbName } from "./naming";

export interface GrafanaServiceConfig {
  vpcId: string;
  /** Where the browser reaches it, with the sub path: https://host/grafana/ */
  publicUrl: string;
  /** JSON secret with discoveryUrl, clientId and clientSecret: the Keycloak client. Name or complete ARN. */
  oauthSecretName?: string;
  /** Keycloak groups that may log in, as Admin and as Viewer. They are the whitelist: a user in neither is refused. */
  adminGroups: string[];
  viewerGroups: string[];
  /** The load balancer that already answers the public hostname: its HTTPS listener gains a /grafana* rule. */
  albListenerArn: string;
  albSecurityGroupId: string;
  rulePriority: number;
  /** Names for the tier map's CloudFront distributions (E123ABC=SMD,...). */
  frontendLabels?: string;
}

export interface GrafanaStackProps extends StackProps {
  envName: string;
  workspace: aps.CfnWorkspace;
  config: GrafanaServiceConfig;
}

/**
 * Grafana as a Fargate service, for an account without the IAM Identity
 * Center that Managed Grafana needs. It holds no state worth keeping: data
 * sources and dashboards are written at start from the image and the task's
 * environment, and users come from Keycloak, so a replaced task is a whole
 * Grafana. It reads Managed Prometheus, CloudWatch and X-Ray with the task
 * role. It has no public address of its own: the environment's load balancer
 * forwards /grafana* to it, and the login is Grafana's own.
 */
export class GrafanaStack extends Stack {
  constructor(scope: Construct, id: string, props: GrafanaStackProps) {
    super(scope, id, props);
    const { envName, workspace, config } = props;
    const name = `${deploymentPrefix(envName)}-grafana`;
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: config.vpcId });

    const oauth = config.oauthSecretName
      ? (config.oauthSecretName.startsWith("arn:")
          ? secretsmanager.Secret.fromSecretCompleteArn(this, "OauthSecret", config.oauthSecretName)
          : secretsmanager.Secret.fromSecretNameV2(this, "OauthSecret", config.oauthSecretName))
      : undefined;
    // For the break-glass admin login; day to day everyone comes in through Keycloak.
    const adminPassword = new secretsmanager.Secret(this, "AdminPassword", {
      secretName: `${deploymentPrefix(envName)}/grafana/admin-password`,
      generateSecretString: { passwordLength: 32, excludePunctuation: true },
    });

    const task = new ecs.FargateTaskDefinition(this, "Task", {
      family: name,
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    task.taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchReadOnlyAccess"));
    task.taskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXrayReadOnlyAccess"));
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["aps:QueryMetrics", "aps:GetLabels", "aps:GetSeries", "aps:GetMetricMetadata"],
      resources: [workspace.attrArn],
    }));
    // The tier map's Logs Insights query over Container Insights, and the CloudWatch data source's resource pickers.
    task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ["ec2:DescribeInstances", "ec2:DescribeRegions", "tag:GetResources", "logs:DescribeLogGroups", "logs:StartQuery", "logs:GetQueryResults", "logs:StopQuery"],
      resources: ["*"],
    }));

    const logGroup = new logs.LogGroup(this, "Logs", { logGroupName: `/${deploymentPrefix(envName)}/grafana`, retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY });
    task.addContainer("grafana", {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, ".."), { file: "grafana/Dockerfile", platform: Platform.LINUX_ARM64 }),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: "grafana" }),
      environment: {
        AWS_REGION: this.region,
        PROMETHEUS_URL: workspace.attrPrometheusEndpoint,
        GRAFANA_PUBLIC_URL: config.publicUrl,
        GRAFANA_ADMIN_GROUPS: config.adminGroups.join(","),
        GRAFANA_VIEWER_GROUPS: config.viewerGroups.join(","),
        FRONTEND_LABELS: config.frontendLabels ?? "",
      },
      // Resolved by ECS when the task starts; the task definition holds only the references.
      secrets: {
        GRAFANA_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminPassword),
        ...(oauth
          ? {
              OAUTH_DISCOVERY_URL: ecs.Secret.fromSecretsManager(oauth, "discoveryUrl"),
              OAUTH_CLIENT_ID: ecs.Secret.fromSecretsManager(oauth, "clientId"),
              OAUTH_CLIENT_SECRET: ecs.Secret.fromSecretsManager(oauth, "clientSecret"),
            }
          : {}),
      },
      healthCheck: { command: ["CMD-SHELL", "curl -fsS -o /dev/null http://127.0.0.1:3000/grafana/api/health"], interval: Duration.seconds(30), startPeriod: Duration.seconds(60) },
    });

    const cluster = new ecs.Cluster(this, "Cluster", { clusterName: name, vpc });
    const serviceSg = new ec2.SecurityGroup(this, "ServiceSg", { vpc, description: `${name} tasks` });
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(this, "AlbSg", config.albSecurityGroupId);
    serviceSg.addIngressRule(albSg, ec2.Port.tcp(3000), "the environment load balancer");
    const service = new ecs.FargateService(this, "Service", {
      serviceName: name,
      cluster,
      taskDefinition: task,
      desiredCount: 1,
      securityGroups: [serviceSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
    });

    const targets = new elbv2.ApplicationTargetGroup(this, "Targets", {
      targetGroupName: elbName(name),
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      // Served under the sub path, so the health endpoint is under it too.
      healthCheck: { path: "/grafana/api/health", interval: Duration.seconds(30), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });
    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, "Listener", { listenerArn: config.albListenerArn, securityGroup: albSg });
    new elbv2.ApplicationListenerRule(this, "Rule", {
      listener,
      priority: config.rulePriority,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/grafana", "/grafana/*"])],
      targetGroups: [targets],
    });

    new CfnOutput(this, "AdminPasswordSecret", { value: adminPassword.secretName, description: "The break-glass admin login (user admin)" });
    new CfnOutput(this, "Url", { value: config.publicUrl });
  }
}
