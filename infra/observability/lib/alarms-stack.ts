import { Duration, Stack, StackProps } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cwactions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import { ObservabilityConfig } from "./config";

export interface AlarmsStackProps extends StackProps {
  config: ObservabilityConfig;
  pages: sns.ITopic;
  warnings: sns.ITopic;
}

/**
 * CloudWatch alarms on the managed services, which do not go through
 * Prometheus: Aurora, the load balancers, MSK consumer lag, and the core
 * cell hosts (EC2 status checks plus the CloudWatch agent's disk and memory).
 * Each group is created only when its identifier is configured.
 */
export class AlarmsStack extends Stack {
  constructor(scope: Construct, id: string, props: AlarmsStackProps) {
    super(scope, id, props);
    const { config, pages, warnings } = props;
    const name = `strato-${config.envName}`;
    const route = (alarm: cloudwatch.Alarm, topic: sns.ITopic) => {
      alarm.addAlarmAction(new cwactions.SnsAction(topic));
      alarm.addOkAction(new cwactions.SnsAction(topic));
    };

    // --- Aurora: replica lag pages (the API tier reads the replicas) ---
    if (config.auroraClusterIdentifier) {
      const dims = { DBClusterIdentifier: config.auroraClusterIdentifier };
      route(
        new cloudwatch.Alarm(this, "AuroraReplicaLag", {
          alarmName: `${name}-aurora-replica-lag`,
          alarmDescription: "Aurora replica lag over 5 s: API and app reads are stale; resolve-by-poll and PostgREST fall behind",
          metric: new cloudwatch.Metric({ namespace: "AWS/RDS", metricName: "AuroraReplicaLagMaximum", dimensionsMap: dims, statistic: "Maximum", period: Duration.minutes(1) }),
          threshold: 5000,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 3,
        }),
        pages
      );
      route(
        new cloudwatch.Alarm(this, "AuroraConnections", {
          alarmName: `${name}-aurora-connections`,
          alarmDescription: "Aurora connections over 800: a tier is leaking pools or the writer is saturated",
          metric: new cloudwatch.Metric({ namespace: "AWS/RDS", metricName: "DatabaseConnections", dimensionsMap: dims, statistic: "Maximum", period: Duration.minutes(5) }),
          threshold: 800,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 2,
        }),
        warnings
      );
      route(
        new cloudwatch.Alarm(this, "AuroraCpu", {
          alarmName: `${name}-aurora-cpu`,
          alarmDescription: "Aurora CPU over 80 percent for 15 minutes",
          metric: new cloudwatch.Metric({ namespace: "AWS/RDS", metricName: "CPUUtilization", dimensionsMap: dims, statistic: "Average", period: Duration.minutes(5) }),
          threshold: 80,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 3,
        }),
        warnings
      );
    }

    // --- Load balancers: 5xx ratio over 1 percent pages ---
    config.albFullNames.forEach((lb, i) => {
      const dims = { LoadBalancer: lb };
      const requests = new cloudwatch.Metric({ namespace: "AWS/ApplicationELB", metricName: "RequestCount", dimensionsMap: dims, statistic: "Sum", period: Duration.minutes(1) });
      const elb5xx = new cloudwatch.Metric({ namespace: "AWS/ApplicationELB", metricName: "HTTPCode_ELB_5XX_Count", dimensionsMap: dims, statistic: "Sum", period: Duration.minutes(1) });
      const target5xx = new cloudwatch.Metric({ namespace: "AWS/ApplicationELB", metricName: "HTTPCode_Target_5XX_Count", dimensionsMap: dims, statistic: "Sum", period: Duration.minutes(1) });
      route(
        new cloudwatch.Alarm(this, `Alb5xx${i}`, {
          alarmName: `${name}-alb-5xx-${i}`,
          alarmDescription: `5xx responses over 1 percent of requests on ${lb}`,
          metric: new cloudwatch.MathExpression({
            expression: "100 * (FILL(elb, 0) + FILL(target, 0)) / MAX([requests, 1])",
            usingMetrics: { elb: elb5xx, target: target5xx, requests },
            label: "5xx percent",
            period: Duration.minutes(1),
          }),
          threshold: 1,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 5,
          datapointsToAlarm: 3,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }),
        pages
      );
    });

    // --- MSK: consumer lag on the ingest and egress groups ---
    // Needs enhanced monitoring PER_TOPIC_PER_PARTITION on the cluster.
    if (config.mskClusterName) {
      config.mskConsumerGroups.forEach((group, i) => {
        route(
          new cloudwatch.Alarm(this, `MskLag${i}`, {
            alarmName: `${name}-bus-lag-${group}`,
            alarmDescription: `Consumer group ${group} is falling behind on the bus: transactions or events are not being consumed`,
            metric: new cloudwatch.Metric({
              namespace: "AWS/Kafka",
              metricName: "SumOffsetLag",
              dimensionsMap: { "Cluster Name": config.mskClusterName!, "Consumer Group": group },
              statistic: "Maximum",
              period: Duration.minutes(1),
            }),
            threshold: 1000,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            evaluationPeriods: 5,
            datapointsToAlarm: 5,
          }),
          pages
        );
      });
      route(
        new cloudwatch.Alarm(this, "MskUnderReplicated", {
          alarmName: `${name}-bus-under-replicated`,
          alarmDescription: "Under-replicated partitions on the bus: a broker is down or behind",
          metric: new cloudwatch.Metric({ namespace: "AWS/Kafka", metricName: "UnderReplicatedPartitions", dimensionsMap: { "Cluster Name": config.mskClusterName }, statistic: "Maximum", period: Duration.minutes(1) }),
          threshold: 0,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 5,
        }),
        warnings
      );
    }

    // --- Core cell hosts ---
    config.cellInstanceIds.forEach((instanceId) => {
      const dims = { InstanceId: instanceId };
      route(
        new cloudwatch.Alarm(this, `CellStatus-${instanceId}`, {
          alarmName: `${name}-cell-${instanceId}-unreachable`,
          alarmDescription: `Core cell ${instanceId} failed its status checks`,
          metric: new cloudwatch.Metric({ namespace: "AWS/EC2", metricName: "StatusCheckFailed", dimensionsMap: dims, statistic: "Maximum", period: Duration.minutes(1) }),
          threshold: 0,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 2,
        }),
        pages
      );
      // The agent config aggregates disk and memory to the InstanceId dimension.
      route(
        new cloudwatch.Alarm(this, `CellDisk-${instanceId}`, {
          alarmName: `${name}-cell-${instanceId}-disk`,
          alarmDescription: `Core cell ${instanceId} has under 15 percent disk free: LevelDB, the local broker and the logs share it`,
          metric: new cloudwatch.Metric({ namespace: "CWAgent", metricName: "disk_used_percent", dimensionsMap: dims, statistic: "Maximum", period: Duration.minutes(5) }),
          threshold: 85,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 2,
        }),
        pages
      );
      route(
        new cloudwatch.Alarm(this, `CellMemory-${instanceId}`, {
          alarmName: `${name}-cell-${instanceId}-memory`,
          alarmDescription: `Core cell ${instanceId} memory over 90 percent: check the RTS heap of vm-runner and the sequencer`,
          metric: new cloudwatch.Metric({ namespace: "CWAgent", metricName: "mem_used_percent", dimensionsMap: dims, statistic: "Average", period: Duration.minutes(5) }),
          threshold: 90,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          evaluationPeriods: 3,
        }),
        warnings
      );
    });
  }
}
