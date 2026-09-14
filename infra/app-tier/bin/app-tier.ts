#!/usr/bin/env node
import { App, Aspects } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { AppTierStack } from "../lib/app-tier-stack";
import { AppUiStack } from "../lib/app-ui-stack";
import { HistoryStack } from "../lib/history-stack";
import { CertificateStack } from "../lib/certificate-stack";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoApp-${config.envName}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, vpcId: config.vpcId });
const tier = new AppTierStack(app, `${prefix}-Tier`, { env, vpc: network.vpc, config });
// CloudFront certificates live in us-east-1: a hostname without an existing
// certificate gets a DNS-validated one there (the validation CNAME goes to the
// registrar), referenced across regions when the app is deployed elsewhere.
// The certificate also serves the ALB (-c albCertificateArn), so it stays when the Ui stack is left out.
const certificate = config.domainName && !config.cloudfrontCertificateArn
  ? new CertificateStack(app, `${prefix}-Certificate`, { env: { ...env, region: "us-east-1" }, domainName: config.domainName, crossRegionReferences: true })
  : undefined;
if (config.uiStack) {
  new AppUiStack(app, `${prefix}-Ui`, { env, config, loadBalancer: tier.loadBalancer, albUsesHttps: tier.albUsesHttps, certificate: certificate?.certificate, crossRegionReferences: true });
}
// The history service (phase 7) deploys once its image exists: -c historyImage=...
if (config.history) {
  new HistoryStack(app, `${prefix}-History`, { env, vpc: network.vpc, config, cluster: tier.cluster, listener: tier.listener });
}

// `-c nag=true` runs the AWS Solutions checks (requires the cdk-nag package).
if (app.node.tryGetContext("nag") === "true") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AwsSolutionsChecks } = require("cdk-nag");
  Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}
