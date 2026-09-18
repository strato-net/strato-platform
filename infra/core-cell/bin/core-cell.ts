#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { CoreCellStack } from "../lib/core-cell-stack";
import { FrontendStack } from "../lib/frontend-stack";

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

// -c frontend=true: the environment's load balancer in front of its cells,
// instead of a cell. It is one per environment, so it takes no cellId.
if (app.node.tryGetContext("frontend") === "true") {
  const list = (key: string) => String(app.node.tryGetContext(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const envName = String(app.node.tryGetContext("envName") ?? "testnet");
  const network = new NetworkStack(app, `StratoCell-${envName}-FrontendNetwork`, { env, vpcId: app.node.tryGetContext("vpcId") });
  new FrontendStack(app, `StratoCell-${envName}-Frontend`, {
    env,
    vpc: network.vpc,
    config: {
      envName,
      cellInstanceIds: list("cellInstanceIds"),
      cellSecurityGroupIds: list("cellSecurityGroupIds"),
      clientSecurityGroupIds: list("clientSecurityGroupIds"),
      submitPort: Number(app.node.tryGetContext("submitPort") ?? "8088"),
      healthPath: String(app.node.tryGetContext("healthPath") ?? "/health"),
    },
  });
} else {
  const config = loadConfig(app);
  // The launch template CDK adds for requireImdsv2 is named "CellLaunchTemplate"
  // in every stack unless this flag is on, and the name is unique per account and
  // region, so a second cell could not be created. Set here as a boolean: a
  // `-c flag=false` on the command line arrives as a string, which reads as on.
  app.node.setContext("@aws-cdk/aws-ec2:uniqueImdsv2TemplateName", !config.legacyLaunchTemplateName);
  const prefix = `StratoCell-${config.envName}-${config.cellId}`;

  const network = new NetworkStack(app, `${prefix}-Network`, { env, vpcId: config.vpcId });
  new CoreCellStack(app, `${prefix}-Host`, { env, vpc: network.vpc, config });
}
