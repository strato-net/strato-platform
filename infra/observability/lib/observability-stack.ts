import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as aps from "aws-cdk-lib/aws-aps";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as grafana from "aws-cdk-lib/aws-grafana";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as synthetics from "aws-cdk-lib/aws-synthetics";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";
import { ObservabilityConfig } from "./config";

export interface ObservabilityStackProps extends StackProps {
  config: ObservabilityConfig;
}

/**
 * The observability plane for one environment.
 *
 * - Amazon Managed Prometheus holds every process's metrics (scraped by the
 *   collectors whose configs this stack publishes to SSM), evaluates the
 *   chain-health rules in rules/chain-health.yaml, and routes alerts through
 *   its alertmanager to two SNS topics: pages and warnings. PagerDuty and
 *   Slack subscribe to those topics out of band.
 * - Amazon Managed Grafana reads Prometheus, CloudWatch and X-Ray through a
 *   role defined here; the four boards in dashboards/ are pushed with
 *   scripts/push-dashboards.sh once the workspace exists.
 * - A synthetic check hits the environment's edge every five minutes and records
 *   the best block's age; its failure pages.
 * - IAM for the collectors: an instance profile for core cells (Prometheus
 *   remote write plus the CloudWatch agent) and a policy the ECS task roles
 *   attach for the sidecar.
 */
export class ObservabilityStack extends Stack {
  readonly pages: sns.Topic;
  readonly warnings: sns.Topic;
  /** The Managed Prometheus workspace, absent in traces-only mode. */
  readonly workspace?: aps.CfnWorkspace;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config } = props;
    const name = `strato-${config.envName}`;
    const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

    // --- Alert routing ---
    this.pages = new sns.Topic(this, "Pages", { topicName: `${name}-pages`, displayName: `STRATO ${config.envName} pages` });
    this.warnings = new sns.Topic(this, "Warnings", { topicName: `${name}-warnings`, displayName: `STRATO ${config.envName} warnings` });

    // --- Managed Prometheus: workspace, rules, alertmanager (unless traces-only) ---
    if (config.managedPrometheus) {
      const alertmanager = read("rules/alertmanager.yaml")
        .replaceAll("__PAGES_TOPIC_ARN__", this.pages.topicArn)
        .replaceAll("__WARNINGS_TOPIC_ARN__", this.warnings.topicArn)
        .replaceAll("__REGION__", this.region);
      this.workspace = new aps.CfnWorkspace(this, "Prometheus", {
        alias: name,
        alertManagerDefinition: alertmanager,
      });
      // Alertmanager publishes to SNS as the workspace's service principal.
      for (const topic of [this.pages, this.warnings]) {
        topic.addToResourcePolicy(
          new iam.PolicyStatement({
            actions: ["sns:Publish", "sns:GetTopicAttributes"],
            principals: [new iam.ServicePrincipal("aps.amazonaws.com")],
            resources: [topic.topicArn],
            conditions: { ArnEquals: { "aws:SourceArn": this.workspace.attrArn } },
          })
        );
      }
      new aps.CfnRuleGroupsNamespace(this, "ChainHealthRules", {
        workspace: this.workspace.attrArn,
        name: "chain-health",
        data: read("rules/chain-health.yaml").replaceAll("__ENV__", config.envName),
      });
    }

    // --- Collector configs, published where cells and tasks read them ---
    // Traces-only: the *-traces variants carry just the OTLP-to-X-Ray pipeline.
    const remoteWriteUrl = this.workspace ? `${this.workspace.attrPrometheusEndpoint}api/v1/remote_write` : "";
    const cellCollector = read(this.workspace ? "config/cell-otel-collector.yaml" : "config/cell-otel-collector-traces.yaml")
      .replaceAll("__REMOTE_WRITE_URL__", remoteWriteUrl)
      .replaceAll("__REGION__", this.region)
      .replaceAll("__ENV__", config.envName);
    const ecsCollector = read(this.workspace ? "config/ecs-otel-sidecar.yaml" : "config/ecs-otel-sidecar-traces.yaml")
      .replaceAll("__REMOTE_WRITE_URL__", remoteWriteUrl)
      .replaceAll("__REGION__", this.region)
      .replaceAll("__ENV__", config.envName);
    const cwAgent = read("config/cell-cloudwatch-agent.json").replaceAll("__ENV__", config.envName);
    const param = (id: string, suffix: string, value: string, description: string) =>
      new ssm.StringParameter(this, id, {
        parameterName: `/strato/${config.envName}/observability/${suffix}`,
        stringValue: value,
        description,
        tier: ssm.ParameterTier.ADVANCED,
      });
    const cellCollectorParam = param("CellCollectorConfig", "otel-collector-cell", cellCollector, "ADOT collector config for core cells: scrapes every node process and remote-writes to Managed Prometheus");
    const ecsCollectorParam = param("EcsCollectorConfig", "otel-collector-ecs", ecsCollector, "ADOT collector config for the ECS sidecar on API, app and history tasks");
    const cwAgentParam = param("CloudWatchAgentConfig", "cloudwatch-agent", cwAgent, "CloudWatch agent config for core cells: host metrics per machine and the convoke process logs");

    // --- IAM for the collectors ---
    const remoteWrite = this.workspace
      ? [new iam.PolicyStatement({
          actions: ["aps:RemoteWrite", "aps:GetSeries", "aps:GetLabels", "aps:GetMetricMetadata"],
          resources: [this.workspace.attrArn],
        })]
      : [];
    const cellRole = new iam.Role(this, "CellRole", {
      roleName: `${name}-cell-observability`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: `${name} core cells: metrics remote write, CloudWatch agent, SSM`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
      ],
    });
    for (const st of remoteWrite) cellRole.addToPolicy(st);
    cellRole.addToPolicy(new iam.PolicyStatement({ actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"], resources: ["*"] }));
    cellCollectorParam.grantRead(cellRole);
    cwAgentParam.grantRead(cellRole);
    new iam.InstanceProfile(this, "CellInstanceProfile", { role: cellRole, instanceProfileName: `${name}-cell-observability` });

    // Attached by the api, app and history task roles for their sidecar.
    const sidecarPolicy = new iam.ManagedPolicy(this, "SidecarPolicy", {
      managedPolicyName: `${name}-otel-sidecar`,
      description: `${name} ECS tasks: ADOT sidecar remote write to Managed Prometheus and X-Ray traces`,
      statements: [
        ...remoteWrite,
        new iam.PolicyStatement({ actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"], resources: ["*"] }),
      ],
    });

    // --- Managed Grafana (unless managedGrafana=false) ---
    let grafanaWorkspace: grafana.CfnWorkspace | undefined;
    if (config.managedGrafana) {
      // --- Managed Grafana ---
      const grafanaRole = new iam.Role(this, "GrafanaRole", {
        roleName: `${name}-grafana`,
        assumedBy: new iam.ServicePrincipal("grafana.amazonaws.com"),
        description: `${name} Grafana: read Managed Prometheus, CloudWatch and X-Ray, notify through SNS`,
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonGrafanaCloudWatchAccess"),
          iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXrayReadOnlyAccess"),
        ],
      });
      grafanaRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["aps:ListWorkspaces", "aps:DescribeWorkspace", "aps:QueryMetrics", "aps:GetLabels", "aps:GetSeries", "aps:GetMetricMetadata", "aps:ListRules", "aps:ListAlerts", "aps:ListAlertManagerAlerts", "aps:GetAlertManagerStatus"],
          resources: ["*"],
        })
      );
      this.pages.grantPublish(grafanaRole);
      this.warnings.grantPublish(grafanaRole);
      grafanaWorkspace = new grafana.CfnWorkspace(this, "Grafana", {
        name,
        description: `STRATO ${config.envName}: infrastructure map, per-tier, per-machine and chain-health boards`,
        accountAccessType: "CURRENT_ACCOUNT",
        authenticationProviders: [config.grafanaAuth],
        permissionType: "CUSTOMER_MANAGED",
        roleArn: grafanaRole.roleArn,
        dataSources: ["PROMETHEUS", "CLOUDWATCH", "XRAY"],
        notificationDestinations: ["SNS"],
        grafanaVersion: config.grafanaVersion,
        pluginAdminEnabled: true,
      });
    }

    // --- Synthetic end-to-end check ---
    if (config.edgeUrl) {
      // Synthetics wants the handler inside node_modules; `npm run canary`
      // installs the signing libraries there and copies canary/src in.
      // Fail at synth, not at run time.
      const assetModules = path.join(__dirname, "..", "canary", "nodejs", "node_modules");
      if (!fs.existsSync(path.join(assetModules, "health.js"))) {
        throw new Error("canary/nodejs/node_modules/health.js is missing: run `npm run canary` in infra/observability first");
      }
      if (config.canaryKeySecretName && !fs.existsSync(path.join(assetModules, "@noble", "curves"))) {
        throw new Error("canaryKeySecretName is set but the signing libraries are not installed: run `npm run canary` in infra/observability first");
      }
      const canaryKey = config.canaryKeySecretName
        ? secretsmanager.Secret.fromSecretNameV2(this, "CanaryKeySecret", config.canaryKeySecretName)
        : undefined;
      const canary = new synthetics.Canary(this, "EdgeHealth", {
        canaryName: `${name}-edge`.slice(0, 21),
        // Five minutes: block age tolerates it, and a one-minute cadence costs
        // about five times more for the same signal.
        schedule: synthetics.Schedule.rate(Duration.minutes(5)),
        runtime: synthetics.Runtime.SYNTHETICS_NODEJS_PUPPETEER_13_0,
        test: synthetics.Test.custom({
          code: synthetics.Code.fromAsset(path.join(__dirname, "..", "canary")),
          handler: "health.handler",
        }),
        environmentVariables: {
          NODE_URL: config.edgeUrl,
          MAX_BLOCK_AGE_SECONDS: String(config.maxBlockAgeSeconds),
          ENV_NAME: config.envName,
          ...(canaryKey
            ? {
                CANARY_KEY_SECRET_ID: canaryKey.secretName,
                CANARY_MAX_INCLUSION_SECONDS: String(config.maxInclusionSeconds),
                CANARY_GAS_LIMIT: String(config.canaryGasLimit),
              }
            : {}),
        },
        startAfterCreation: true,
        cleanup: synthetics.Cleanup.LAMBDA,
        timeToLive: Duration.hours(0),
      });
      canary.role.addToPrincipalPolicy(
        new iam.PolicyStatement({ actions: ["cloudwatch:PutMetricData"], resources: ["*"], conditions: { StringEquals: { "cloudwatch:namespace": "STRATO" } } })
      );
      if (canaryKey) {
        canaryKey.grantRead(canary.role);
        // Inclusion slower than 10 s on average over 5 minutes warns before the
        // block-age page would fire: the chain still moves, but users wait.
        const slow = new cloudwatch.Alarm(this, "InclusionSlow", {
          alarmName: `${name}-inclusion-slow`,
          alarmDescription: "The canary's transactions take over 10 s from submit to receipt: check ingest lag, the sequencer, and the indexers",
          metric: new cloudwatch.Metric({
            namespace: "STRATO",
            metricName: "TimeToInclusionSeconds",
            dimensionsMap: { Environment: config.envName },
            statistic: "Average",
            period: Duration.minutes(5),
          }),
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          threshold: 10,
          evaluationPeriods: 2,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        slow.addAlarmAction(new cwactions.SnsAction(this.warnings));
        slow.addOkAction(new cwactions.SnsAction(this.warnings));
      }
      const failing = new cloudwatch.Alarm(this, "EdgeHealthFailing", {
        alarmName: `${name}-edge-health`,
        alarmDescription: "The synthetic end-to-end check against the edge failed: the edge is down, the chain is not producing, or the block age exceeded the limit",
        metric: canary.metricSuccessPercent({ period: Duration.minutes(5), statistic: "Average" }),
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        threshold: 100,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      });
      failing.addAlarmAction(new cwactions.SnsAction(this.pages));
      failing.addOkAction(new cwactions.SnsAction(this.pages));
    }

    if (this.workspace) {
      new CfnOutput(this, "PrometheusWorkspaceId", { value: this.workspace.attrWorkspaceId });
      new CfnOutput(this, "PrometheusEndpoint", { value: this.workspace.attrPrometheusEndpoint });
    }
    if (grafanaWorkspace) new CfnOutput(this, "GrafanaUrl", { value: `https://${grafanaWorkspace.attrEndpoint}` });
    new CfnOutput(this, "PagesTopicArn", { value: this.pages.topicArn, description: "Subscribe PagerDuty here" });
    new CfnOutput(this, "WarningsTopicArn", { value: this.warnings.topicArn, description: "Subscribe Slack here" });
    new CfnOutput(this, "CellInstanceProfileName", { value: `${name}-cell-observability`, description: "Instance profile for core cell hosts" });
    new CfnOutput(this, "SidecarPolicyArn", { value: sidecarPolicy.managedPolicyArn, description: "Attach to ECS task roles that run the ADOT sidecar" });
    new CfnOutput(this, "EcsCollectorParameter", { value: ecsCollectorParam.parameterName, description: "Pass as -c otelConfigParameterName to the api-tier and app-tier apps" });
  }
}
