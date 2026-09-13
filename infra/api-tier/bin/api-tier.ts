#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { ApiTierStack } from "../lib/api-tier-stack";
import { CertificateStack } from "../lib/certificate-stack";
import { SmdUiStack } from "../lib/smd-ui-stack";

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
new ApiTierStack(app, `${prefix}-Tier`, {
  env,
  vpc: network.vpc,
  config,
  albCertificate: certificate?.certificate,
  extraCertificates: smdCertificate ? [smdCertificate.certificate] : undefined,
});
if (config.smdDomainName) {
  new SmdUiStack(app, `${prefix}-Smd`, { env, config, certificate: smdCertificate?.certificate });
}
