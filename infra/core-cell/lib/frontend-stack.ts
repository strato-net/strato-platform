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
  /** The cells' submit server: its port and the path that answers 200 while it can take a transaction. */
  submitPort: number;
  healthPath: string;
}

export interface FrontendStackProps extends StackProps {
  vpc: ec2.IVpc;
  config: FrontendConfig;
}

/**
 * One name in front of every core cell of an environment, so the API tier
 * does not know how many cells there are or which one is the writer. It
 * carries the submit server only, and to every healthy cell at once: a
 * transaction may enter through any cell (its sequencer gossips it), and the
 * result is read back from the shared cluster, whichever cell wrote it. A
 * cell's Kafka is not behind it and cannot be: each cell is its own broker,
 * and a broker sends clients to its own address after the first connection.
 */
export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    const { vpc, config } = props;
    const name = `strato-core-${config.envName}`;

    const lbSg = new ec2.SecurityGroup(this, "LbSg", { vpc, description: `${name} load balancer`, allowAllOutbound: false });
    config.clientSecurityGroupIds.forEach((id, i) => {
      lbSg.addIngressRule(ec2.SecurityGroup.fromSecurityGroupId(this, `Client${i}`, id), ec2.Port.tcp(config.submitPort), "submit");
    });
    config.cellSecurityGroupIds.forEach((id, i) => {
      const cell = ec2.SecurityGroup.fromSecurityGroupId(this, `Cell${i}`, id);
      cell.addIngressRule(lbSg, ec2.Port.tcp(config.submitPort), `${name}: submit`);
      lbSg.addEgressRule(cell, ec2.Port.tcp(config.submitPort), "submit");
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
    const targets = new elbv2.NetworkTargetGroup(this, "Submit", {
      vpc,
      port: config.submitPort,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: config.cellInstanceIds.map((id) => new InstanceIdTarget(id, config.submitPort)),
      healthCheck: { protocol: elbv2.Protocol.HTTP, path: config.healthPath, interval: Duration.seconds(10), healthyThresholdCount: 2, unhealthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });
    lb.addListener("Submit", { port: config.submitPort, protocol: elbv2.Protocol.TCP, defaultTargetGroups: [targets] });

    new CfnOutput(this, "DnsName", { value: lb.loadBalancerDnsName, description: "The core tier's name: the API tier submits here" });
    new CfnOutput(this, "LoadBalancerSecurityGroupId", { value: lbSg.securityGroupId });
  }
}
