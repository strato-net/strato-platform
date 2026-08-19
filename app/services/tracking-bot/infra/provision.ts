// Provision (idempotently) the EC2 host for the tracking bot:
//   Ubuntu 24.04 (latest Canonical AMI via SSM), gp3 root volume, a dedicated
//   security group (SSH from BOT_SSH_CIDR only; the bot needs no inbound
//   traffic), a key pair saved to infra/<key>.pem, and cloud-init user data
//   (infra/user-data.sh) that installs docker. Writes infra/instance.local.json
//   for infra/deploy-bot.sh.
//
// Usage:  AWS_PROFILE=... (or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) \
//         BOT_SSH_CIDR=203.0.113.4/32 npm run provision
// Env:    AWS_REGION (us-east-1), BOT_INSTANCE_NAME (tracking-bot),
//         BOT_INSTANCE_TYPE (t3.medium), BOT_KEY_NAME (tracking-bot),
//         BOT_VOLUME_GB (40), BOT_VPC_ID / BOT_SUBNET_ID (default VPC),
//         BOT_SSH_CIDR (required unless the SG already exists)
import {
  AuthorizeSecurityGroupIngressCommand,
  CreateKeyPairCommand,
  CreateSecurityGroupCommand,
  DescribeInstancesCommand,
  DescribeKeyPairsCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
  RunInstancesCommand,
  waitUntilInstanceRunning,
} from "@aws-sdk/client-ec2";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import fs from "fs";
import path from "path";

const region = process.env.AWS_REGION ?? "us-east-1";
const name = process.env.BOT_INSTANCE_NAME ?? "tracking-bot";
const instanceType = process.env.BOT_INSTANCE_TYPE ?? "t3.medium";
const keyName = process.env.BOT_KEY_NAME ?? "tracking-bot";
const volumeGb = Number(process.env.BOT_VOLUME_GB ?? 40);
const sshCidr = process.env.BOT_SSH_CIDR;
const infraDir = __dirname;
const keyPath = path.join(infraDir, `${keyName}.pem`);
const outPath = path.join(infraDir, "instance.local.json");

const ec2 = new EC2Client({ region });
const ssm = new SSMClient({ region });

const log = (msg: string) => console.log(`[provision] ${msg}`);

const latestUbuntuAmi = async (): Promise<string> => {
  const { Parameter } = await ssm.send(
    new GetParameterCommand({ Name: "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id" })
  );
  if (!Parameter?.Value) throw new Error("could not resolve the Ubuntu 24.04 AMI from SSM");
  return Parameter.Value;
};

const ensureKeyPair = async (): Promise<void> => {
  const existing = await ec2.send(new DescribeKeyPairsCommand({ KeyNames: [keyName] })).catch((e) => (e?.name === "InvalidKeyPair.NotFound" ? null : Promise.reject(e)));
  if (existing?.KeyPairs?.length) {
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Key pair ${keyName} exists in AWS but ${keyPath} is missing locally. Set BOT_KEY_NAME to a new name or restore the PEM.`);
    }
    log(`key pair ${keyName} exists`);
    return;
  }
  const created = await ec2.send(new CreateKeyPairCommand({ KeyName: keyName, KeyType: "ed25519", KeyFormat: "pem" }));
  fs.writeFileSync(keyPath, created.KeyMaterial ?? "", { mode: 0o600 });
  log(`created key pair ${keyName} → ${keyPath}`);
};

const resolveVpcAndSubnet = async (): Promise<{ vpcId: string; subnetId: string }> => {
  let vpcId = process.env.BOT_VPC_ID;
  if (!vpcId) {
    const { Vpcs } = await ec2.send(new DescribeVpcsCommand({ Filters: [{ Name: "is-default", Values: ["true"] }] }));
    vpcId = Vpcs?.[0]?.VpcId;
    if (!vpcId) throw new Error("no default VPC; set BOT_VPC_ID and BOT_SUBNET_ID");
  }
  let subnetId = process.env.BOT_SUBNET_ID;
  if (!subnetId) {
    const { Subnets } = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }, { Name: "default-for-az", Values: ["true"] }] }));
    subnetId = Subnets?.[0]?.SubnetId;
    if (!subnetId) {
      const any = await ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }] }));
      subnetId = any.Subnets?.[0]?.SubnetId;
    }
    if (!subnetId) throw new Error(`no subnet found in ${vpcId}; set BOT_SUBNET_ID`);
  }
  return { vpcId, subnetId };
};

const ensureSecurityGroup = async (vpcId: string): Promise<string> => {
  const groupName = `${name}-sg`;
  const { SecurityGroups } = await ec2.send(
    new DescribeSecurityGroupsCommand({ Filters: [{ Name: "group-name", Values: [groupName] }, { Name: "vpc-id", Values: [vpcId] }] })
  );
  let groupId = SecurityGroups?.[0]?.GroupId;
  if (!groupId) {
    const created = await ec2.send(
      new CreateSecurityGroupCommand({
        GroupName: groupName,
        Description: "STRATO tracking bot host: SSH from operators only",
        VpcId: vpcId,
        TagSpecifications: [{ ResourceType: "security-group", Tags: [{ Key: "Name", Value: groupName }, { Key: "app", Value: "tracking-bot" }] }],
      })
    );
    groupId = created.GroupId!;
    log(`created security group ${groupName} (${groupId})`);
  } else {
    log(`security group ${groupName} exists (${groupId})`);
  }
  if (sshCidr) {
    try {
      await ec2.send(
        new AuthorizeSecurityGroupIngressCommand({
          GroupId: groupId,
          IpPermissions: [{ IpProtocol: "tcp", FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: sshCidr, Description: "operator ssh" }] }],
        })
      );
      log(`allowed SSH from ${sshCidr}`);
    } catch (error: any) {
      if (error?.name !== "InvalidPermission.Duplicate") throw error;
      log(`SSH from ${sshCidr} already allowed`);
    }
  }
  return groupId;
};

const findInstance = async (): Promise<{ id: string; ip?: string; state?: string } | null> => {
  const { Reservations } = await ec2.send(
    new DescribeInstancesCommand({
      Filters: [
        { Name: "tag:Name", Values: [name] },
        { Name: "instance-state-name", Values: ["pending", "running", "stopping", "stopped"] },
      ],
    })
  );
  const instance = Reservations?.flatMap((r) => r.Instances ?? [])[0];
  return instance?.InstanceId ? { id: instance.InstanceId, ip: instance.PublicIpAddress, state: instance.State?.Name } : null;
};

const main = async (): Promise<void> => {
  log(`region=${region} name=${name} type=${instanceType} key=${keyName}`);
  await ensureKeyPair();
  const { vpcId, subnetId } = await resolveVpcAndSubnet();
  const groupId = await ensureSecurityGroup(vpcId);

  let instance = await findInstance();
  if (!instance) {
    const ami = await latestUbuntuAmi();
    const userData = fs.readFileSync(path.join(infraDir, "user-data.sh"), "utf8");
    const run = await ec2.send(
      new RunInstancesCommand({
        ImageId: ami,
        InstanceType: instanceType as any,
        KeyName: keyName,
        MinCount: 1,
        MaxCount: 1,
        NetworkInterfaces: [{ DeviceIndex: 0, SubnetId: subnetId, Groups: [groupId], AssociatePublicIpAddress: true }],
        BlockDeviceMappings: [{ DeviceName: "/dev/sda1", Ebs: { VolumeSize: volumeGb, VolumeType: "gp3", DeleteOnTermination: true } }],
        UserData: Buffer.from(userData).toString("base64"),
        MetadataOptions: { HttpTokens: "required", HttpEndpoint: "enabled" },
        TagSpecifications: [
          { ResourceType: "instance", Tags: [{ Key: "Name", Value: name }, { Key: "app", Value: "tracking-bot" }] },
          { ResourceType: "volume", Tags: [{ Key: "Name", Value: `${name}-root` }, { Key: "app", Value: "tracking-bot" }] },
        ],
      })
    );
    const id = run.Instances?.[0]?.InstanceId!;
    log(`launched ${id} (${ami}); waiting for running state`);
    await waitUntilInstanceRunning({ client: ec2, maxWaitTime: 300 }, { InstanceIds: [id] });
    instance = await findInstance();
  } else {
    log(`instance ${instance.id} exists (${instance.state}, ip ${instance.ip ?? "n/a"})`);
  }
  if (!instance?.ip) throw new Error("instance has no public IP yet; re-run in a minute");

  const out = { region, instanceId: instance.id, publicIp: instance.ip, keyPath, keyName, securityGroupId: groupId, sshUser: "ubuntu", provisionedAt: new Date().toISOString() };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  log(`ready: ssh -i ${keyPath} ubuntu@${instance.ip}`);
  log(`wrote ${outPath}; next: fill infra/bot.env then infra/deploy-bot.sh up (cloud-init needs ~2 minutes first)`);
};

main().catch((error) => {
  console.error("[provision] failed:", error);
  process.exit(1);
});
