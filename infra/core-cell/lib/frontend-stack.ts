import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { InstanceIdTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { Construct } from "constructs";

export interface FrontendConfig {
  envName: string;
  /** The cells behind the load balancer, and their security groups (each cell stack's InstanceId and SecurityGroupId outputs). */
  cellInstanceIds: string[];
  cellSecurityGroupIds: string[];
  /** Security groups allowed to submit: the API tier's TaskSecurityGroupId. */
  clientSecurityGroupIds: string[];
  /** The cells' VPC-facing Kafka listener. */
  kafkaPort: number;
  /** What says a cell can take a transaction: an HTTP 200 here. The default is the sequencer's metrics endpoint, since a broker with no sequencer behind it accepts transactions that go nowhere. */
  healthPort: number;
  healthPath: string;
}

export interface FrontendStackProps extends StackProps {
  vpc: ec2.IVpc;
  config: FrontendConfig;
}

/**
 * One name in front of every core cell of an environment, so the API tier
 * does not know how many cells there are or which one is the writer. It
 * carries the cells' Kafka listener, where the API tier submits transactions.
 *
 * Each cell is a broker of its own, not a member of one cluster, and that is
 * fine for this client and only this kind: the API tier produces and never
 * consumes (results are read from the shared database), with a client that
 * keeps no producer or cluster identity, and a transaction may enter through
 * any cell, whose sequencer gossips it. Two things make it hold together.
 * Every cell advertises THIS name on its external listener
 * (-c kafkaExternalHost), because a broker sends clients to its advertised
 * address after the first connection, which would otherwise bypass the load
 * balancer. And the target group is sticky by source address, so all of one
 * task's connections reach one cell and it sees one coherent broker; when
 * that cell goes unhealthy its connections are dropped and the task's next
 * ones land on another. Do not put a consumer behind this: offsets mean
 * nothing across cells.
 */
export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { vpc, config } = props;
    const name = `strato-core-${config.envName}`;

    const lbSg = new ec2.SecurityGroup(this, "LbSg", { vpc, description: `${name} load balancer`, allowAllOutbound: false });
    config.clientSecurityGroupIds.forEach((id, i) => {
      lbSg.addIngressRule(ec2.SecurityGroup.fromSecurityGroupId(this, `Client${i}`, id), ec2.Port.tcp(config.kafkaPort), "Kafka");
    });
    config.cellSecurityGroupIds.forEach((id, i) => {
      const cell = ec2.SecurityGroup.fromSecurityGroupId(this, `Cell${i}`, id);
      cell.addIngressRule(lbSg, ec2.Port.tcp(config.kafkaPort), `${name}: Kafka`);
      lbSg.addEgressRule(cell, ec2.Port.tcp(config.kafkaPort), "Kafka");
      cell.addIngressRule(lbSg, ec2.Port.tcp(config.healthPort), `${name}: health check`);
      lbSg.addEgressRule(cell, ec2.Port.tcp(config.healthPort), "health check");
    });

    const lb = new elbv2.NetworkLoadBalancer(this, "Lb", {
      loadBalancerName: name,
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lbSg],
      // A task in one zone must still reach the cell in the other when its own is down.
      crossZoneEnabled: true,
    });
    const targets = new elbv2.NetworkTargetGroup(this, "Kafka", {
      vpc,
      port: config.kafkaPort,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: config.cellInstanceIds.map((id) => new InstanceIdTarget(id, config.kafkaPort)),
      healthCheck: { protocol: elbv2.Protocol.HTTP, port: String(config.healthPort), path: config.healthPath, interval: Duration.seconds(10), healthyThresholdCount: 2, unhealthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });
    // One task, one cell: see above.
    targets.setAttribute("stickiness.enabled", "true");
    targets.setAttribute("stickiness.type", "source_ip");
    lb.addListener("Kafka", { port: config.kafkaPort, protocol: elbv2.Protocol.TCP, defaultTargetGroups: [targets] });

    new CfnOutput(this, "DnsName", { value: lb.loadBalancerDnsName, description: "The core tier's name: -c kafkaHost on the API tier, -c kafkaExternalHost on every cell" });
    new CfnOutput(this, "LoadBalancerSecurityGroupId", { value: lbSg.securityGroupId });
  }
}
