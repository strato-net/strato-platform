import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { InstanceIdTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { Construct } from "constructs";
import { CoreNlbConfig } from "./config";
import { deploymentPrefix, elbName } from "./naming";

export interface CoreNlbStackProps extends StackProps {
  config: CoreNlbConfig;
}

// What a cell listens on: the transaction ingress (strato-ingest), its health
// (strato-cell-health) and the node's Prometheus (exposePrometheus).
const INGRESS_PORT = 8600;
const HEALTH_PORT = 8601;
const PROMETHEUS_PORT = 9090;

/**
 * One name in front of every core cell of an environment, so the API tier
 * does not know how many cells there are, where they run or which one is the
 * writer, and a replaced cell needs no change there.
 *
 * Port 8600 carries the cells' transaction ingress. A batch goes to one
 * healthy cell, which appends it to its ingest log before it answers and
 * gossips it to the network and to the other cells; any cell will do, since
 * none of them votes and the writer lease only decides which one indexes.
 * Healthy is what the cell's own check says on port 8601 (every core process
 * answers, the node follows the chain, the cell is not draining for a restart
 * or an upgrade), so a cell that could accept a batch and get it nowhere is
 * out within about 25 seconds. With every cell unhealthy the load balancer
 * sends to all of them, which is right when the fault is the network's.
 *
 * Port 9090 is the first cell's Prometheus alone, for the API tier's apex:
 * its stall check compares one node's counters between two looks, so it must
 * not alternate between cells.
 *
 * The API tier app admits its tasks on this load balancer's security group
 * (its coreLoadBalancerSecurityGroupId); the cells admit only the load
 * balancer.
 */
export class CoreNlbStack extends Stack {
  constructor(scope: Construct, id: string, props: CoreNlbStackProps) {
    super(scope, id, props);
    const { config } = props;
    const name = `${deploymentPrefix(config.envName)}-core`;
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: config.vpcId });

    const lbSg = new ec2.SecurityGroup(this, "LbSg", { vpc, description: `${name} load balancer`, allowAllOutbound: false });
    const cells = config.cellSecurityGroupIds.map((sgId, i) => ec2.SecurityGroup.fromSecurityGroupId(this, `Cell${i}`, sgId));
    const open = (cell: ec2.ISecurityGroup, port: number, what: string) => {
      cell.addIngressRule(lbSg, ec2.Port.tcp(port), `${name}: ${what}`);
      lbSg.addEgressRule(cell, ec2.Port.tcp(port), what);
    };
    for (const cell of cells) {
      open(cell, INGRESS_PORT, "transaction ingress");
      open(cell, HEALTH_PORT, "health check");
    }
    open(cells[0], PROMETHEUS_PORT, "Prometheus");

    const lb = new elbv2.NetworkLoadBalancer(this, "Lb", {
      loadBalancerName: elbName(name),
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, onePerAz: true },
      securityGroups: [lbSg],
      // A task in one zone must still reach the cell in the other when its own is down.
      crossZoneEnabled: true,
    });

    const ingress = new elbv2.NetworkTargetGroup(this, "Ingress", {
      targetGroupName: elbName(`${name}-${INGRESS_PORT}`),
      vpc,
      port: INGRESS_PORT,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: config.cellInstanceIds.map((instanceId) => new InstanceIdTarget(instanceId, INGRESS_PORT)),
      // The cell answers a probe at once from its last check (it runs one every
      // 2 s), so the timeout only has to cover the network.
      healthCheck: {
        protocol: elbv2.Protocol.HTTP,
        port: String(HEALTH_PORT),
        path: "/",
        interval: Duration.seconds(10),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 2,
      },
      deregistrationDelay: Duration.seconds(30),
    });
    lb.addListener("Ingress", { port: INGRESS_PORT, protocol: elbv2.Protocol.TCP, defaultTargetGroups: [ingress] });

    const prometheus = new elbv2.NetworkTargetGroup(this, "Prometheus", {
      targetGroupName: elbName(`${name}-${PROMETHEUS_PORT}`),
      vpc,
      port: PROMETHEUS_PORT,
      protocol: elbv2.Protocol.TCP,
      targetType: elbv2.TargetType.INSTANCE,
      targets: [new InstanceIdTarget(config.cellInstanceIds[0], PROMETHEUS_PORT)],
      // Through the cell's socat to the node's Prometheus, which serves under /prometheus.
      healthCheck: { protocol: elbv2.Protocol.HTTP, path: "/prometheus/-/healthy", interval: Duration.seconds(30), healthyThresholdCount: 2, unhealthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });
    lb.addListener("Prometheus", { port: PROMETHEUS_PORT, protocol: elbv2.Protocol.TCP, defaultTargetGroups: [prometheus] });

    new CfnOutput(this, "DnsName", { value: lb.loadBalancerDnsName, description: `The core tier's name: the api-tier app's ingressUrls (http://<name>:${INGRESS_PORT}) and prometheusHost (<name>:${PROMETHEUS_PORT})` });
    new CfnOutput(this, "SecurityGroupId", { value: lbSg.securityGroupId, description: "The api-tier app's coreLoadBalancerSecurityGroupId" });
  }
}
