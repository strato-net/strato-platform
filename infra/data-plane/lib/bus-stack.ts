import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as msk from "aws-cdk-lib/aws-msk";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface BusStackProps extends StackProps {
  envName: string;
  vpc: ec2.IVpc;
  kafkaVersion: string;
  brokerInstanceType: string;
  brokerCount: number;
  volumeSizeGb: number;
  /** Security groups and CIDRs allowed to connect (core hosts, API and app tiers). */
  clientSecurityGroupIds: string[];
  clientCidrs: string[];
}

/**
 * The shared message bus (Phase 4): an MSK cluster carrying transactions
 * inbound to the cores (ingest_tx) and results and chain events outbound
 * (tx_results, chain_events). Clients authenticate with SASL/SCRAM over
 * TLS; one SCRAM secret is created per client role and associated with the
 * cluster. Topics are created by the clients themselves at startup
 * (strato-ingest, slipstream, strato-api), with one partition each: order
 * matters more than throughput here, and the core's client reads a single
 * partition.
 */
export class BusStack extends Stack {
  readonly cluster: msk.CfnCluster;

  constructor(scope: Construct, id: string, props: BusStackProps) {
    super(scope, id, props);
    const name = `strato-bus-${props.envName}`;

    const securityGroup = new ec2.SecurityGroup(this, "BusSg", { vpc: props.vpc, description: `${name} brokers`, allowAllOutbound: false });
    for (const sgId of props.clientSecurityGroupIds) {
      securityGroup.addIngressRule(ec2.Peer.securityGroupId(sgId), ec2.Port.tcp(9096), `SASL_SSL from ${sgId}`);
    }
    for (const cidr of props.clientCidrs) {
      securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(9096), `SASL_SSL from ${cidr}`);
    }

    const logGroup = new logs.LogGroup(this, "BrokerLogs", { logGroupName: `/strato/bus/${props.envName}`, retention: logs.RetentionDays.TWO_WEEKS });

    const configuration = new msk.CfnConfiguration(this, "Config", {
      name: `${name}-config`,
      kafkaVersionsList: [props.kafkaVersion],
      serverProperties: [
        "auto.create.topics.enable=false",
        "default.replication.factor=2",
        "min.insync.replicas=1",
        "num.partitions=1",
        // Transactions submitted while a core is down must still be there
        // when it returns; results are re-derivable from Postgres.
        "log.retention.hours=168",
        "message.max.bytes=2500000",
      ].join("\n"),
    });

    this.cluster = new msk.CfnCluster(this, "Cluster", {
      clusterName: name,
      kafkaVersion: props.kafkaVersion,
      numberOfBrokerNodes: props.brokerCount,
      brokerNodeGroupInfo: {
        instanceType: props.brokerInstanceType,
        clientSubnets: props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds.slice(0, props.brokerCount),
        securityGroups: [securityGroup.securityGroupId],
        storageInfo: { ebsStorageInfo: { volumeSize: props.volumeSizeGb } },
      },
      configurationInfo: { arn: configuration.attrArn, revision: 1 },
      encryptionInfo: {
        encryptionInTransit: { clientBroker: "TLS", inCluster: true },
      },
      clientAuthentication: { sasl: { scram: { enabled: true } }, unauthenticated: { enabled: false } },
      loggingInfo: { brokerLogs: { cloudWatchLogs: { enabled: true, logGroup: logGroup.logGroupName } } },
      openMonitoring: { prometheus: { jmxExporter: { enabledInBroker: true }, nodeExporter: { enabledInBroker: true } } },
    });

    // One SCRAM credential per client role. MSK requires the AmazonMSK_
    // prefix and a customer-managed KMS key.
    const key = new kms.Key(this, "ScramKey", { description: `${name} SCRAM secrets`, enableKeyRotation: true });
    const roles = ["core", "api", "app"];
    const secretArns = roles.map((role) => {
      const secret = new secretsmanager.Secret(this, `Scram-${role}`, {
        secretName: `AmazonMSK_${name}-${role}`,
        encryptionKey: key,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: `strato-${role}` }),
          generateStringKey: "password",
          excludePunctuation: true,
          passwordLength: 32,
        },
      });
      new CfnOutput(this, `ScramSecret-${role}`, { value: secret.secretName, description: `SASL/SCRAM credentials for the ${role} role` });
      return secret.secretArn;
    });
    const association = new msk.CfnBatchScramSecret(this, "ScramSecrets", { clusterArn: this.cluster.attrArn, secretArnList: secretArns });
    association.addResourceDependency(this.cluster);

    new CfnOutput(this, "ClusterArn", { value: this.cluster.attrArn });
    new CfnOutput(this, "BootstrapBrokersCommand", {
      value: `aws kafka get-bootstrap-brokers --cluster-arn ${this.cluster.attrArn} --query BootstrapBrokerStringSaslScram --output text`,
      description: "Bootstrap host:port list for busHost/busPort (port 9096)",
    });
    new CfnOutput(this, "BusSecurityGroupId", { value: securityGroup.securityGroupId });
  }
}
