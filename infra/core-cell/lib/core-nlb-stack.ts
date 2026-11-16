import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { CoreNlbConfig } from "./config";
import { deploymentPrefix, elbName } from "./naming";

export interface CoreNlbStackProps extends StackProps {
  config: CoreNlbConfig;
}

// What a cell listens on: the transaction ingress (strato-ingest), its health
// (strato-cell-health), the node's Prometheus (exposePrometheus) and Grafana.
const INGRESS_PORT = 8600;
const HEALTH_PORT = 8601;
const PROMETHEUS_PORT = 9090;
const GRAFANA_PORT = 3001;

/**
 * One name in front of every core cell of an environment, so the API tier
 * does not know how many cells there are, where they run or which one is the
 * writer, and a replaced cell needs no change there. It is deployed before
 * the cells and knows none of them: it owns the target groups, and each cell
 * registers its instance in them (its Auto Scaling group) and admits this
 * load balancer on its own security group.
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
 * Port 9090 is one cell's Prometheus alone (the cell given this target
 * group), for the API tier's apex: its stall check compares one node's
 * counters between two looks, so it must not alternate between cells.
 *
 * The Grafana target group belongs to no listener here: the API tier's load
 * balancer forwards /grafana to it (that app's grafanaTargetGroupArn). It
 * lives in this stack so that the cell running Grafana can register in it
 * when the cell is created, before the API tier exists.
 *
 * The API tier app admits its tasks on this load balancer's security group
 * (its coreLoadBalancerSecurityGroupId).
 *
 * The stack also owns the bucket the cells take their node scripts from
 * (each cell's extraBinariesS3), for the same reason: it has to exist before
 * the first cell.
 */
export class CoreNlbStack extends Stack {
  constructor(scope: Construct, id: string, props: CoreNlbStackProps) {
    super(scope, id, props);
    const { config } = props;
    const name = `${deploymentPrefix(config.envName)}-core`;
    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: config.vpcId });

    // Out to the cells only on their ports; which hosts those are is for each
    // cell's security group to say.
    const lbSg = new ec2.SecurityGroup(this, "LbSg", { vpc, description: `${name} load balancer`, allowAllOutbound: false });
    for (const [port, what] of [[INGRESS_PORT, "transaction ingress"], [HEALTH_PORT, "health check"], [PROMETHEUS_PORT, "Prometheus"]] as const) {
      lbSg.addEgressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(port), `cells: ${what}`);
    }

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
      // Through the cell's socat to the node's Prometheus, which serves under /prometheus.
      healthCheck: { protocol: elbv2.Protocol.HTTP, path: "/prometheus/-/healthy", interval: Duration.seconds(30), healthyThresholdCount: 2, unhealthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });
    lb.addListener("Prometheus", { port: PROMETHEUS_PORT, protocol: elbv2.Protocol.TCP, defaultTargetGroups: [prometheus] });

    const grafana = new elbv2.ApplicationTargetGroup(this, "Grafana", {
      targetGroupName: elbName(`${name}-grafana`),
      vpc,
      port: GRAFANA_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.INSTANCE,
      // Served under the sub path, so the health endpoint is under it too.
      healthCheck: { path: "/grafana/api/health", interval: Duration.seconds(30), healthyThresholdCount: 2 },
      deregistrationDelay: Duration.seconds(30),
    });

    // The node scripts: a cell installs every file under node-scripts/ into
    // /usr/local/bin as root, at its first boot and on each upgrade, so who
    // may write here decides what the cells run. A bucket of the
    // environment's own, with no grant in it: the deployment's pipeline
    // writes it through its own IAM policy and the cells read it through
    // their instance roles, while what may write a shared artifacts bucket
    // (other builds) has no way in. Versions are kept, so an overwrite leaves
    // what it replaced. The content is published again on every run, hence
    // nothing to keep when the stack goes.
    const nodeScripts = new s3.Bucket(this, "NodeScripts", {
      bucketName: `${deploymentPrefix(config.envName)}-node-scripts-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new CfnOutput(this, "DnsName", { value: lb.loadBalancerDnsName, description: `The core tier's name: the api-tier app's ingressUrls (http://<name>:${INGRESS_PORT}) and prometheusHost (<name>:${PROMETHEUS_PORT})` });
    new CfnOutput(this, "SecurityGroupId", { value: lbSg.securityGroupId, description: "The api-tier app's and every cell's coreLoadBalancerSecurityGroupId" });
    new CfnOutput(this, "IngressTargetGroupArn", { value: ingress.targetGroupArn, description: "Every cell's ingressTargetGroupArn" });
    new CfnOutput(this, "PrometheusTargetGroupArn", { value: prometheus.targetGroupArn, description: "prometheusTargetGroupArn of the one cell whose Prometheus apex reads" });
    new CfnOutput(this, "NodeScriptsBucketName", { value: nodeScripts.bucketName, description: "Every cell's extraBinariesS3 is s3://<name>/node-scripts/; scripts/ha.sh publish-scripts fills it" });
    new CfnOutput(this, "GrafanaTargetGroupArn", { value: grafana.targetGroupArn, description: "grafanaTargetGroupArn of the cell running Grafana, and of the api-tier app" });
  }
}
