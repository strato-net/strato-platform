import { ArnFormat, CfnOutput, Duration, Fn, Stack, StackProps, Tags } from "aws-cdk-lib";
import * as autoscaling from "aws-cdk-lib/aws-autoscaling";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";
import { CoreCellConfig } from "./config";
import { deploymentPrefix } from "./naming";

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
 * The host is the one instance of an Auto Scaling group, so a cell whose
 * instance is lost, or handed back by its own watchdog or by `cells replace`,
 * is built again from the launch template: the new instance takes the cell's
 * Elastic IP, restores the latest snapshot and registers in the core tier's
 * target groups. Nothing here replaces a running instance: a changed launch
 * template only decides what the next one boots.
 *
 * The cell is a follower by default (`--writer=false --validatorBehavior=false`):
 * it indexes into the cluster only when it holds the writer lease, and it
 * never votes. `-c writer=true` makes it the writer core; promotion of a
 * running follower is `strato-promote`, see design-documents/standby-core.md.
 *
 * What the host reads at boot, with the instance role: the strato image from
 * its registry (ghcr.io is public and needs no login; ECR uses the role), the
 * Aurora master secret (the password reaches strato-setup on the host and
 * nowhere else), the bootstrap script from this stack's asset bucket, and,
 * when configured, the collector configs the observability app published in
 * SSM.
 */
export class CoreCellStack extends Stack {
  readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: CoreCellStackProps) {
    super(scope, id, { ...props, terminationProtection: props.config.terminationProtection });
    const { vpc, config } = props;
    const name = `${deploymentPrefix(config.envName)}-cell-${config.cellId}`;

    // --- Network ---
    this.securityGroup = new ec2.SecurityGroup(this, "CellSg", {
      vpc,
      securityGroupName: name,
      description: `${name} core cell: p2p from peers, transaction ingress from the API tier, SSH from the bastion`,
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
      this.securityGroup.addIngressRule(client, ec2.Port.tcp(8600), "transaction ingress (strato-ingest; the API tier posts here)");
    });
    if (config.coreLoadBalancerSecurityGroupId) {
      const lb = ec2.SecurityGroup.fromSecurityGroupId(this, "CoreLbSg", config.coreLoadBalancerSecurityGroupId, { mutable: false });
      this.securityGroup.addIngressRule(lb, ec2.Port.tcp(8600), "transaction ingress, through the core tier's load balancer");
      this.securityGroup.addIngressRule(lb, ec2.Port.tcp(8601), "health check of the core tier's load balancer");
      if (config.exposePrometheus) this.securityGroup.addIngressRule(lb, ec2.Port.tcp(9090), "Prometheus, through the core tier's load balancer");
    }
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
      roleName: name,
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
    const parameterArns = [config.otelConfigParameterName, config.cloudWatchAgentParameterName, config.stratoImageParameter]
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
    // bin/strato-* live in the strato-platform checkout: a sibling of this repo
    // by default, or wherever STRATO_PLATFORM_DIR points.
    const platformBin = path.resolve(process.env.STRATO_PLATFORM_DIR ?? path.resolve(__dirname, "../../../strato-platform"), "bin");
    if (!fs.existsSync(path.join(platformBin, "strato-up"))) {
      throw new Error(`${platformBin} has no strato-up; set STRATO_PLATFORM_DIR to a strato-platform checkout`);
    }
    const nodeScripts = new s3assets.Asset(this, "NodeScripts", {
      path: platformBin,
      exclude: ["strato-pg-migrate", "strato-patch-app"],
    });
    const dashboards = new s3assets.Asset(this, "Dashboards", { path: path.join(__dirname, "..", "..", "observability", "dashboards") });
    bootstrap.grantRead(role);
    nodeScripts.grantRead(role);
    dashboards.grantRead(role);

    // --- The address peers dial: the instance takes it at boot ---
    const eip = config.subnetType === "public" ? new ec2.CfnEIP(this, "Eip", { domain: "vpc", tags: [{ key: "Name", value: name }] }) : undefined;
    if (eip) {
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["ec2:AssociateAddress"],
          resources: [
            this.formatArn({ service: "ec2", resource: "elastic-ip", resourceName: eip.attrAllocationId }),
            this.formatArn({ service: "ec2", resource: "instance", resourceName: "*" }),
            this.formatArn({ service: "ec2", resource: "network-interface", resourceName: "*" }),
          ],
        }),
      );
    }
    // The watchdog hands an instance it cannot revive back to the group, and
    // only while another cell is healthy behind the load balancer.
    if (config.ingressTargetGroupArn) {
      role.addToPolicy(new iam.PolicyStatement({ actions: ["elasticloadbalancing:DescribeTargetHealth"], resources: ["*"] }));
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["autoscaling:SetInstanceHealth"],
          resources: [this.formatArn({ service: "autoscaling", resource: "autoScalingGroup", resourceName: `*:autoScalingGroupName/${name}`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })],
        }),
      );
    }

    // --- The host ---
    const userData = ec2.UserData.forLinux();
    const settings: Record<string, string> = {
      STRATO_ENV: config.envName,
      CELL_ID: config.cellId,
      NETWORK: config.network,
      STRATO_IMAGE: config.stratoImage,
      STRATO_IMAGE_PARAMETER: config.stratoImageParameter ?? "",
      EIP_ALLOCATION_ID: eip?.attrAllocationId ?? "",
      EIP_PUBLIC_IP: eip?.attrPublicIp ?? "",
      INGRESS_TARGET_GROUP_ARN: config.ingressTargetGroupArn ?? "",
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
      SEED_EMPTY_CLUSTER: String(config.seedEmptyCluster),
      VALIDATOR_BEHAVIOR: String(config.validatorBehavior),
      VM_QUERY: String(config.vmQuery),
      SNAPSHOT_SOURCE: config.snapshotSource ?? "",
      SNAPSHOT_BUCKET: config.snapshotBucket ?? "",
      SNAPSHOT_SKIP_DATABASES: String(config.snapshotSkipDatabases),
      AUTO_PROMOTE: String(config.autoPromote),
      AUTO_PROMOTE_AFTER: String(config.autoPromoteAfter),
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

    const launchTemplate = new ec2.LaunchTemplate(this, "CellTemplate", {
      launchTemplateName: name,
      instanceType: new ec2.InstanceType(config.instanceType),
      machineImage: ec2.MachineImage.fromSsmParameter(config.amiParameter, { os: ec2.OperatingSystemType.LINUX }),
      securityGroup: this.securityGroup,
      role,
      keyPair: config.keyPairName ? ec2.KeyPair.fromKeyPairName(this, "KeyPair", config.keyPairName) : undefined,
      userData,
      requireImdsv2: true,
      detailedMonitoring: true,
      // A public address from the first second, whatever the subnet's own
      // setting: the bootstrap needs the network to take the Elastic IP.
      associatePublicIpAddress: eip ? true : undefined,
      // Both volumes go with their instance: the next one restores a snapshot.
      blockDevices: [
        { deviceName: "/dev/sda1", volume: ec2.BlockDeviceVolume.ebs(config.rootVolumeGiB, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true, deleteOnTermination: true }) },
        { deviceName: "/dev/sdf", volume: ec2.BlockDeviceVolume.ebs(config.dataVolumeGiB, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true, deleteOnTermination: true }) },
      ],
    });
    // One instance, replaced only when EC2 loses it or it is marked unhealthy
    // (the cell's watchdog, scripts/ha.sh cells replace): the node's own
    // health is the watchdog's to judge, not the load balancer's.
    const group = new autoscaling.AutoScalingGroup(this, "Cell", {
      autoScalingGroupName: name,
      vpc,
      vpcSubnets: {
        subnetType: config.subnetType === "public" ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_EGRESS,
        ...(config.availabilityZone ? { availabilityZones: [config.availabilityZone] } : {}),
      },
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      // For the alarm on a cell left without an instance (the observability app).
      groupMetrics: [new autoscaling.GroupMetrics(autoscaling.GroupMetric.IN_SERVICE_INSTANCES)],
    });
    const targetGroupArns = [config.ingressTargetGroupArn, config.prometheusTargetGroupArn, config.grafanaTargetGroupArn].filter((arn): arn is string => !!arn);
    if (targetGroupArns.length > 0) (group.node.defaultChild as autoscaling.CfnAutoScalingGroup).targetGroupArns = targetGroupArns;
    // The group tags the instances it launches, the template their volumes.
    for (const tagged of [group, launchTemplate]) {
      Tags.of(tagged).add("Name", name);
      Tags.of(tagged).add("strato:cell", config.cellId);
      Tags.of(tagged).add("strato:env", config.envName);
      Tags.of(tagged).add("strato:role", config.role);
    }

    const publicAddress = eip?.attrPublicIp;

    // --- Outputs ---
    new CfnOutput(this, "AutoScalingGroupName", { value: group.autoScalingGroupName, description: "The group whose one instance is the cell; scripts/ha.sh <env> cells instance <id> names that instance" });
    if (publicAddress) new CfnOutput(this, "PublicIp", { value: publicAddress, description: "Elastic IP; the address peers dial" });
    if (publicAddress && config.role === "node") new CfnOutput(this, "AppUrl", { value: config.tlsHostname ? `https://${config.tlsHostname}/` : Fn.join("", ["http://", publicAddress, `:${config.httpPort}/`]) });
    if (publicAddress && config.grafana) new CfnOutput(this, "GrafanaUrl", { value: Fn.join("", ["http://", publicAddress, ":3001/"]) });
    new CfnOutput(this, "SecurityGroupId", { value: this.securityGroup.securityGroupId, description: "The cell's group; already allowed on the cluster when postgresSecurityGroupId was given" });
    new CfnOutput(this, "NodeDirectory", { value: "/var/lib/strato/node", description: "strato-up/strato-down/strato-ps take this path; logs under logs/" });
    new CfnOutput(this, "BootstrapLog", { value: "/var/log/strato-cell-bootstrap.log", description: `Read it after the first boot; the node starts within about ${Duration.minutes(10).toMinutes()} minutes plus snapshot restore time` });
  }
}
