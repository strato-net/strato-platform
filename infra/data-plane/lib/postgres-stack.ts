import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { deploymentPrefix } from "./naming";

export interface PostgresStackProps extends StackProps {
  envName: string;
  /** Existing VPC id (the node's), or omit to create a two-AZ VPC. */
  vpcId?: string;
  /**
   * NAT gateways of the VPC this stack creates. One (the default) serves both zones: when its
   * zone fails, the private subnets of the other lose their way out (the tiers' calls to the
   * OAuth provider, registries and the public hostname). Two give each zone its own, at the
   * price of a second gateway.
   */
  natGateways?: number;
  /** Aurora PostgreSQL version; 14 matches the node's postgres:14.18 container. */
  engineVersion: string;
  writerInstanceClass: string;
  readerInstanceClass: string;
  readerCount: number;
  /** Security groups and CIDRs allowed to connect (the core host, API and app tiers). */
  clientSecurityGroupIds: string[];
  clientCidrs: string[];
  /** Secrets Manager name for the generated master credentials. */
  secretName: string;
  /**
   * The login the node and the tiers connect with, and the Secrets Manager name for its generated
   * password. Not `<secretName>-` and six characters: a lookup by name would read that as the
   * master secret's name with its random suffix.
   */
  nodeLogin: string;
  nodeLoginSecretName: string;
}

/**
 * The shared Postgres cluster: one writer (the core's indexer and slipstream
 * write it) and read replicas behind the reader endpoint (PostgREST, the app
 * backend and, once it moves out, strato-api read them). The eth and cirrus
 * databases are created by the node processes themselves at first start, as
 * they are on the container today.
 */
export class PostgresStack extends Stack {
  readonly cluster: rds.DatabaseCluster;
  readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: PostgresStackProps) {
    super(scope, id, props);
    const name = `${deploymentPrefix(props.envName)}-postgres`;

    const vpc = props.vpcId
      ? ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId })
      : new ec2.Vpc(this, "Vpc", {
          maxAzs: 2,
          natGateways: props.natGateways ?? 1,
          subnetConfiguration: [
            { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
            { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
          ],
        });
    this.vpc = vpc;

    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.of(props.engineVersion, props.engineVersion.split(".")[0]),
    });

    // Postgres settings the node relied on in its container (max_connections
    // 800). Aurora sizes max_connections from instance memory and the r7g
    // classes exceed that; the rest of the container's flags were defaults.
    const parameters = new rds.ParameterGroup(this, "Params", {
      engine,
      description: `${name} eth/cirrus`,
      parameters: {
        // Cirrus creates a table, view and function per contract; keep the
        // statement log useful without logging every DDL.
        log_min_duration_statement: "2000",
        // slipstream relies on NOTIFY on the writer; replicas use the
        // PostgREST schema watcher instead.
        "rds.force_ssl": "0",
        // A transaction left open on the reader pins the writer's vacuum
        // horizon (Aurora readers report their oldest snapshot to the
        // writer), and Cirrus rewrites the same rows every block, so one
        // leaked session bloats the churned tables and slows slipstream to
        // a crawl within hours. Ten minutes is far past any legitimate
        // idle gap (vm-query re-pins its epoch every 30 s).
        idle_in_transaction_session_timeout: "600000",
        // Cirrus lists sort and group far more rows than they return (an
        // event view groups a month of rows to show ten), and at the 4 MB
        // default those sorts go to temporary files: on the production
        // readers the executed-issues list took 7.2 s, and 4.7 s from 16 MB
        // up. In kB.
        work_mem: "32768",
      },
    });

    const securityGroup = new ec2.SecurityGroup(this, "ClusterSg", { vpc, description: `${name} postgres`, allowAllOutbound: false });
    for (const sgId of props.clientSecurityGroupIds) {
      securityGroup.addIngressRule(ec2.Peer.securityGroupId(sgId), ec2.Port.tcp(5432), `client sg ${sgId}`);
    }
    for (const cidr of props.clientCidrs) {
      securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(5432), `client cidr ${cidr}`);
    }

    this.cluster = new rds.DatabaseCluster(this, "Cluster", {
      engine,
      clusterIdentifier: name,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [securityGroup],
      credentials: rds.Credentials.fromGeneratedSecret("postgres", { secretName: props.secretName }),
      parameterGroup: parameters,
      writer: rds.ClusterInstance.provisioned("writer", {
        instanceType: new ec2.InstanceType(props.writerInstanceClass),
        enablePerformanceInsights: true,
      }),
      readers: Array.from({ length: props.readerCount }, (_, i) =>
        rds.ClusterInstance.provisioned(`reader${i + 1}`, {
          instanceType: new ec2.InstanceType(props.readerInstanceClass),
          enablePerformanceInsights: true,
          // Promotable ahead of any others so a writer failure promotes a
          // same-sized reader.
          promotionTier: 1,
        })
      ),
      storageEncrypted: true,
      backup: { retention: Duration.days(7), preferredWindow: "06:00-07:00" },
      preferredMaintenanceWindow: "Sun:07:00-Sun:08:00",
      cloudwatchLogsExports: ["postgresql"],
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // RETAIN reaches the instances too, and a reader the settings no longer
    // ask for then stays in the cluster outside this stack: behind the reader
    // endpoint, and paid for. The data is on the cluster's volume, not on an
    // instance, so a reader goes with its resource. The writer keeps RETAIN.
    for (let i = 1; i <= props.readerCount; i++) {
      (this.cluster.node.findChild(`reader${i}`).node.defaultChild as rds.CfnDBInstance).applyRemovalPolicy(RemovalPolicy.DESTROY);
    }

    // The node's own login, so that nothing but its creation uses the master
    // login. Aurora knows nothing of it: the password is generated here and
    // the first core cell creates the role with it (cell-bootstrap.sh).
    // Letters and digits only: it is written into a YAML file and a
    // connection URI.
    new secretsmanager.Secret(this, "NodeLoginSecret", {
      secretName: props.nodeLoginSecretName,
      description: `${name}: the ${props.nodeLogin} login of the node, the API tier and the app tier`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: props.nodeLogin }),
        generateStringKey: "password",
        passwordLength: 40,
        excludePunctuation: true,
      },
    });

    new CfnOutput(this, "WriterEndpoint", { value: this.cluster.clusterEndpoint.hostname, description: "--pghost for the core" });
    new CfnOutput(this, "ReaderEndpoint", { value: this.cluster.clusterReadEndpoint.hostname, description: "--pgReaderHost; PostgREST, app backend, API tier reads" });
    new CfnOutput(this, "SecretName", { value: props.secretName, description: "Master credentials (JSON with username/password)" });
    new CfnOutput(this, "NodeLogin", { value: props.nodeLogin, description: "--pguser for the core; the tiers' Postgres user" });
    new CfnOutput(this, "NodeLoginSecretName", { value: props.nodeLoginSecretName, description: "Its credentials (JSON with username/password)" });
    new CfnOutput(this, "ClusterSecurityGroupId", { value: securityGroup.securityGroupId });
    // The addresses the tiers' tasks leave the VPC from. The app backend calls the node through
    // its public hostname, so the API tier's nginx sees every such call come from them.
    if (vpc instanceof ec2.Vpc) {
      const natAddresses = vpc.publicSubnets.flatMap((subnet) => {
        const eip = subnet.node.tryFindChild("EIP");
        return eip instanceof ec2.CfnEIP ? [eip.ref] : [];
      });
      new CfnOutput(this, "NatGatewayAddresses", { value: Fn.join(",", natAddresses) });
    }
  }
}
