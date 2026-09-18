#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { ApiTierStack } from "../lib/api-tier-stack";
import { CertificateStack } from "../lib/certificate-stack";
import { SmdUiStack } from "../lib/smd-ui-stack";
import { FrontDoorStack } from "../lib/front-door-stack";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoApi-${config.envName}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, vpcId: config.vpcId });
// A hostname without an existing certificate gets a DNS-validated one; the
// tier's HTTPS listener waits on it (the validation CNAME goes to the registrar).
const certificate = config.domainName && !config.albCertificateArn
  ? new CertificateStack(app, `${prefix}-Certificate`, { env, domainName: config.domainName })
  : undefined;
// The SMD's hostname: one certificate (us-east-1, as CloudFront requires) serves
// both CloudFront and this tier's ALB, which CloudFront reaches with the
// viewer's Host header. The validation CNAME goes to the registrar.
const smdCertificate = config.smdDomainName
  ? new CertificateStack(app, `${prefix}-SmdCertificate`, { env, domainName: config.smdDomainName })
  : undefined;
// The front door's hostname: the same arrangement, for the distribution that
// serves every UI. The app tier's ALB needs this certificate too
// (-c extraCertificateArns=... there, from this stack's CertificateArn output).
const frontDoorCertificate = config.frontDoorDomainName && !config.frontDoorCertificateArn
  ? new CertificateStack(app, `${prefix}-FrontDoorCertificate`, { env, domainName: config.frontDoorDomainName })
  : undefined;

const extraCertificates = [smdCertificate, frontDoorCertificate].flatMap((c) => (c ? [c.certificate] : []));
new ApiTierStack(app, `${prefix}-Tier`, {
  env,
  vpc: network.vpc,
  config,
  albCertificate: certificate?.certificate,
  extraCertificates: extraCertificates.length ? extraCertificates : undefined,
});
if (config.smdDomainName) {
  new SmdUiStack(app, `${prefix}-Smd`, { env, config, certificate: smdCertificate?.certificate });
}
// With frontDoorCertificateArn the stacks resolve that certificate themselves.
if (config.frontDoorDomainName) {
  new FrontDoorStack(app, `${prefix}-FrontDoor`, { env, config, certificate: frontDoorCertificate?.certificate });
}
