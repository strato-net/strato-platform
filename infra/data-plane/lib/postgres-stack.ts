import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

export interface PostgresStackProps extends StackProps {
  envName: string;
  /** Existing VPC id (the node's), or omit to create a two-AZ VPC. */
  vpcId?: string;
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
    const name = `strato-${props.envName}`;

    const vpc = props.vpcId
      ? ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId })
      : new ec2.Vpc(this, "Vpc", {
          maxAzs: 2,
          natGateways: 1,
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

    new CfnOutput(this, "WriterEndpoint", { value: this.cluster.clusterEndpoint.hostname, description: "--pghost for the core" });
    new CfnOutput(this, "ReaderEndpoint", { value: this.cluster.clusterReadEndpoint.hostname, description: "--pgReaderHost; PostgREST, app backend, API tier reads" });
    new CfnOutput(this, "SecretName", { value: props.secretName, description: "Master credentials (JSON with username/password)" });
    new CfnOutput(this, "ClusterSecurityGroupId", { value: securityGroup.securityGroupId });
  }
}
