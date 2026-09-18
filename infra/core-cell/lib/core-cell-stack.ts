import { ArnFormat, CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps, Tags } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "path";
import { CoreCellConfig } from "./config";

export interface CoreCellStackProps extends StackProps {
  vpc: ec2.IVpc;
  config: CoreCellConfig;
}

/**
 * One core cell: an EC2 host that runs the node's consensus, VM and indexer
 * processes under convoke, exactly as the testnet hosts do today, with three
 * differences: Postgres is the shared Aurora cluster (`--pghost`), the host
 * is built from nothing at boot (Ubuntu 24.04, the strato image's base, with
 * the binaries extracted from that image), and convoke is supervised by
 * systemd so a reboot brings the node back.
 *
 * The cell is a follower by default (`--writer=false --validatorBehavior=false`):
 * it indexes into the cluster only when it holds the writer lease, and it
 * never votes. `-c writer=true` makes it the writer core; promotion of a
 * running follower is `strato-promote`, see design-documents/standby-core.md.
 *
 * What the host reads at boot, with the instance role: the strato image from
 * ECR, the Aurora master secret (the password reaches strato-setup on the
 * host and nowhere else), the bootstrap script from this stack's asset
 * bucket, and, when configured, the collector configs the observability app
 * published in SSM.
 */
export class CoreCellStack extends Stack {
  readonly instance: ec2.Instance;
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: CoreCellStackProps) {
    super(scope, id, { ...props, terminationProtection: props.config.terminationProtection });
    const { vpc, config } = props;
    const name = `strato-${config.envName}-${config.cellId}`;

    // --- Network ---
    this.securityGroup = new ec2.SecurityGroup(this, "CellSg", {
      vpc,
      securityGroupName: name,
      description: `${name} core cell: p2p from peers, Kafka and API from the API tier, SSH from the bastion`,
      allowAllOutbound: true,
    });
    for (const cidr of config.p2pCidrs) {
      this.securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(30303), "p2p (rlpx)");
      this.securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.udp(30303), "p2p (discovery)");
    }
    if (config.role === "node") {
      for (const cidr of config.webCidrs) {
        this.securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(config.httpPort), "app (nginx)");
        this.securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(443), "app (nginx, TLS)");
      }
    }
    if (config.tlsHostname) {
      // Let's Encrypt HTTP-01 challenges arrive on port 80 from anywhere.
      this.securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "Lets Encrypt HTTP-01 challenge");
    }
    if (config.grafana) {
      // Not webCidrs: that is the public web port, and without grafanaPublicUrl
      // this Grafana serves plain HTTP with anonymous viewer access, so
      // inheriting 0.0.0.0/0 would publish the node's metrics to anyone.
      // Default is no rule at all - reach it with `aws ssm start-session
      // --document-name AWS-StartPortForwardingSession`, or through the API
      // tier's ALB, which opens this port to itself alone and puts Grafana's
      // Keycloak login in front. -c grafanaCidrs=... opens it to named
      // networks as well.
      for (const cidr of config.grafanaCidrs) this.securityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(3001), "Grafana");
    }
    config.clientSecurityGroupIds.forEach((sgId, i) => {
      const client = ec2.SecurityGroup.fromSecurityGroupId(this, `ClientSg${i}`, sgId, { mutable: false });
      this.securityGroup.addIngressRule(client, ec2.Port.tcp(9094), "Kafka external listener (API tier submits here)");
      this.securityGroup.addIngressRule(client, ec2.Port.tcp(3000), "strato-api");
      this.securityGroup.addIngressRule(client, ec2.Port.tcp(8545), "ethereum-jsonrpc");
    });
    if (config.postgresSecurityGroupId) {
      // The cluster's group is imported mutable: the rule lives in this stack and goes with it.
      const cluster = ec2.SecurityGroup.fromSecurityGroupId(this, "ClusterSg", config.postgresSecurityGroupId);
      cluster.addIngressRule(this.securityGroup, ec2.Port.tcp(config.postgresPort), `${name} core cell`);
    }
    if (config.sshSourceSecurityGroupId) {
      const bastion = ec2.SecurityGroup.fromSecurityGroupId(this, "BastionSg", config.sshSourceSecurityGroupId, { mutable: false });
      this.securityGroup.addIngressRule(bastion, ec2.Port.tcp(22), "SSH from the bastion");
    }

    // --- Identity ---
    const role = new iam.Role(this, "CellRole", {
      roleName: `${name}-cell`,
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: `${name} core cell host: pull the strato image, read the Aurora secret, SSM, observability`,
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"),
      ],
    });
    const postgres = secretsmanager.Secret.fromSecretNameV2(this, "PostgresSecret", config.postgresSecretName);
    postgres.grantRead(role);
    if (config.oauthSecretName) {
      secretsmanager.Secret.fromSecretNameV2(this, "OauthSecret", config.oauthSecretName).grantRead(role);
    }
    if (config.prometheusWorkspaceArn) {
      role.addToPolicy(new iam.PolicyStatement({ actions: ["aps:RemoteWrite"], resources: [config.prometheusWorkspaceArn] }));
    }
    if (config.otelConfigParameterName) {
      // The cell's collector ships spans to X-Ray; with Grafana on the host,
      // its X-Ray data source reads the service map back with the same role.
      role.addToPolicy(new iam.PolicyStatement({ actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"], resources: ["*"] }));
      if (config.grafana) role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSXrayReadOnlyAccess"));
    }
    if (config.grafana) {
      // The tier map reads ECS Container Insights (Logs Insights) and the
      // Aurora instances' metrics through a CloudWatch data source that
      // authenticates with the instance role.
      role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchReadOnlyAccess"));
      role.addToPolicy(new iam.PolicyStatement({ actions: ["ec2:DescribeInstances", "ec2:DescribeRegions", "tag:GetResources", "logs:DescribeLogGroups", "logs:StartQuery", "logs:GetQueryResults", "logs:StopQuery"], resources: ["*"] }));
    }
    const parameterArns = [config.otelConfigParameterName, config.cloudWatchAgentParameterName]
      .filter((p): p is string => !!p)
      .map((p) => this.formatArn({ service: "ssm", resource: "parameter", resourceName: p.replace(/^\//, "") }));
    if (parameterArns.length > 0) {
      role.addToPolicy(new iam.PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: parameterArns }));
    }
    // The node config this cell publishes for the API tier: written as a SecureString
    // (the file carries the node's database password), so the role also needs to encrypt
    // with the account's SSM key.
    if (config.ethconfParameterName) {
      const arn = this.formatArn({ service: "ssm", resource: "parameter", resourceName: config.ethconfParameterName.replace(/^\//, "") });
      role.addToPolicy(new iam.PolicyStatement({ actions: ["ssm:PutParameter", "ssm:GetParameter"], resources: [arn] }));
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"],
          resources: ["*"],
          conditions: { StringEquals: { "kms:ViaService": `ssm.${this.region}.amazonaws.com` } },
        }),
      );
    }
    if (config.extraBinariesS3) {
      const m = config.extraBinariesS3.match(/^s3:\/\/([^/]+)\/(.*)$/);
      if (!m) throw new Error(`extraBinariesS3 must be s3://bucket/prefix/, got ${config.extraBinariesS3}`);
      role.addToPolicy(new iam.PolicyStatement({ actions: ["s3:GetObject"], resources: [`arn:aws:s3:::${m[1]}/${m[2]}*`] }));
      role.addToPolicy(new iam.PolicyStatement({ actions: ["s3:ListBucket"], resources: [`arn:aws:s3:::${m[1]}`] }));
    }
    if (config.publishSecretNames.length > 0) {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DescribeSecret", "secretsmanager:TagResource"],
          resources: config.publishSecretNames.map((n) => this.formatArn({ service: "secretsmanager", resource: "secret", resourceName: `${n}-*`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })),
        })
      );
    }
    if (config.snapshotBucket) {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: [`arn:aws:s3:::${config.snapshotBucket}`, `arn:aws:s3:::${config.snapshotBucket}/*`],
        })
      );
    }

    // --- Bootstrap: the script and the repo's node scripts, as one asset ---
    const bootstrap = new s3assets.Asset(this, "Bootstrap", { path: path.join(__dirname, "..", "bootstrap") });
    const nodeScripts = new s3assets.Asset(this, "NodeScripts", {
      path: path.join(__dirname, "..", "..", "..", "bin"),
      exclude: ["strato-pg-migrate", "strato-patch-app"],
    });
    const dashboards = new s3assets.Asset(this, "Dashboards", { path: path.join(__dirname, "..", "..", "observability", "dashboards") });
    bootstrap.grantRead(role);
    nodeScripts.grantRead(role);
    dashboards.grantRead(role);

    // --- The host ---
    const userData = ec2.UserData.forLinux();
    const settings: Record<string, string> = {
      STRATO_ENV: config.envName,
      CELL_ID: config.cellId,
      NETWORK: config.network,
      STRATO_IMAGE: config.stratoImage,
      REPO_URL: config.repoUrl,
      EXTRA_BINARIES_S3: config.extraBinariesS3 ?? "",
      PG_WRITER_HOST: config.postgresWriterHost,
      PG_READER_HOST: config.postgresReaderHost,
      PG_PORT: String(config.postgresPort),
      PG_USER: config.postgresUser,
      PG_SECRET_ID: config.postgresSecretName,
      ROLE: config.role,
      TLS_HOSTNAME: config.tlsHostname ?? "",
      LETSENCRYPT_EMAIL: config.letsEncryptEmail ?? "",
      LOCAL_AUTH: String(config.localAuth),
      OAUTH_SECRET_ID: config.oauthSecretName ?? "",
      GRAFANA: String(config.grafana),
      GRAFANA_PUBLIC_URL: config.grafanaPublicUrl ?? "",
      GRAFANA_ADMIN_GROUPS: config.grafanaAdminGroups.join(","),
      GRAFANA_VIEWER_GROUPS: config.grafanaViewerGroups.join(","),
      PROMETHEUS_EXPOSE: String(config.exposePrometheus),
      ETHCONF_PARAMETER: config.ethconfParameterName ?? "",
      DASHBOARDS_S3: dashboards.s3ObjectUrl,
      PEER_DATABASE: config.peerDatabase ?? "",
      PEER_STORE: config.peerStore,
      WRITER: String(config.writer),
      VALIDATOR_BEHAVIOR: String(config.validatorBehavior),
      VM_QUERY: String(config.vmQuery),
      SNAPSHOT_SOURCE: config.snapshotSource ?? "",
      SNAPSHOT_BUCKET: config.snapshotBucket ?? "",
      EXTRA_SETUP_FLAGS: config.extraSetupFlags,
      BUNDLED_APP: String(config.bundledApp),
      APP_URL: config.appUrl ?? "",
      BUNDLED_SMD: String(config.bundledSmd),
      SMD_URL: config.smdUrl ?? "",
      BUNDLED_POSTGREST: String(config.bundledPostgrest),
      FRONTEND_LABELS: config.frontendLabels ?? "",
      OTEL_CONFIG_PARAMETER: config.otelConfigParameterName ?? "",
      CW_AGENT_PARAMETER: config.cloudWatchAgentParameterName ?? "",
      BOOTSTRAP_S3: bootstrap.s3ObjectUrl,
      NODE_SCRIPTS_S3: nodeScripts.s3ObjectUrl,
      AWS_REGION: this.region,
      DATA_DEVICE: "/dev/sdf",
    };
    userData.addCommands(
      "set -euo pipefail",
      "install -d -m 0755 /etc/strato",
      `cat > /etc/strato/cell.env <<'EOF'\n${Object.entries(settings)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join("\n")}\nEOF`,
      "chmod 0644 /etc/strato/cell.env",
      // The AWS CLI is not on the Ubuntu image; snap is.
      "snap install aws-cli --classic",
      "install -d /opt/strato/bootstrap",
      `aws s3 cp ${bootstrap.s3ObjectUrl} /opt/strato/bootstrap/bootstrap.zip`,
      "cd /opt/strato/bootstrap && apt-get install -y unzip >/dev/null && unzip -o -q bootstrap.zip",
      "bash /opt/strato/bootstrap/cell-bootstrap.sh 2>&1 | tee -a /var/log/strato-cell-bootstrap.log"
    );

    this.instance = new ec2.Instance(this, "Cell", {
      vpc,
      vpcSubnets: { subnetType: config.subnetType === "public" ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: new ec2.InstanceType(config.instanceType),
      machineImage: ec2.MachineImage.fromSsmParameter(config.amiParameter, { os: ec2.OperatingSystemType.LINUX }),
      securityGroup: this.securityGroup,
      role,
      keyPair: config.keyPairName ? ec2.KeyPair.fromKeyPairName(this, "KeyPair", config.keyPairName) : undefined,
      userData,
      userDataCausesReplacement: false,
      requireImdsv2: true,
      detailedMonitoring: true,
      instanceName: name,
      blockDevices: [
        { deviceName: "/dev/sda1", volume: ec2.BlockDeviceVolume.ebs(config.rootVolumeGiB, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true, deleteOnTermination: true }) },
        { deviceName: "/dev/sdf", volume: ec2.BlockDeviceVolume.ebs(config.dataVolumeGiB, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true, deleteOnTermination: false }) },
      ],
    });
    this.instance.applyRemovalPolicy(config.terminationProtection ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY);
    Tags.of(this.instance).add("strato:cell", config.cellId);
    Tags.of(this.instance).add("strato:env", config.envName);
    Tags.of(this.instance).add("strato:role", `${config.role}-${config.writer ? "writer" : "follower"}`);

    let publicAddress: string | undefined;
    if (config.subnetType === "public") {
      const eip = new ec2.CfnEIP(this, "Eip", { domain: "vpc", tags: [{ key: "Name", value: name }] });
      new ec2.CfnEIPAssociation(this, "EipAssociation", { allocationId: eip.attrAllocationId, instanceId: this.instance.instanceId });
      publicAddress = eip.attrPublicIp;
    }

    // --- Outputs ---
    new CfnOutput(this, "InstanceId", { value: this.instance.instanceId });
    new CfnOutput(this, "PrivateIp", { value: this.instance.instancePrivateIp });
    new CfnOutput(this, "PrivateDnsName", { value: this.instance.instancePrivateDnsName, description: "The cell's Kafka external listener host (port 9094): pass as -c kafkaHost to the api-tier app" });
    if (publicAddress) new CfnOutput(this, "PublicIp", { value: publicAddress, description: "Elastic IP; the address peers dial" });
    if (publicAddress && config.role === "node") new CfnOutput(this, "AppUrl", { value: config.tlsHostname ? `https://${config.tlsHostname}/` : Fn.join("", ["http://", publicAddress, `:${config.httpPort}/`]) });
    if (publicAddress && config.grafana) new CfnOutput(this, "GrafanaUrl", { value: Fn.join("", ["http://", publicAddress, ":3001/"]) });
    new CfnOutput(this, "SecurityGroupId", { value: this.securityGroup.securityGroupId, description: "The cell's group; already allowed on the cluster when postgresSecurityGroupId was given" });
    new CfnOutput(this, "NodeDirectory", { value: "/var/lib/strato/node", description: "strato-up/strato-down/strato-ps take this path; logs under logs/" });
    new CfnOutput(this, "SessionManager", { value: Fn.join("", ["aws ssm start-session --target ", this.instance.instanceId]) });
    new CfnOutput(this, "BootstrapLog", { value: "/var/log/strato-cell-bootstrap.log", description: `Read it after the first boot; the node starts within about ${Duration.minutes(10).toMinutes()} minutes plus snapshot restore time` });
  }
}
