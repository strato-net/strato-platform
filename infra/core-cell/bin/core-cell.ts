#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { CoreCellStack } from "../lib/core-cell-stack";
import { FrontendStack } from "../lib/frontend-stack";
import { deploymentPrefix, tagDeployment } from "../lib/naming";

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

// -c frontend=true: the environment's load balancer in front of its cells,
// instead of a cell. It is one per environment, so it takes no cellId.
if (app.node.tryGetContext("frontend") === "true") {
  const list = (key: string) => String(app.node.tryGetContext(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const envName = String(app.node.tryGetContext("envName") ?? "testnet");
  const prefix = `${deploymentPrefix(envName)}-core-frontend`;
  tagDeployment(app, envName);
  const network = new NetworkStack(app, `${prefix}-network`, { env, vpcId: app.node.tryGetContext("vpcId") });
  new FrontendStack(app, prefix, {
    env,
    vpc: network.vpc,
    config: {
      envName,
      cellInstanceIds: list("cellInstanceIds"),
      cellSecurityGroupIds: list("cellSecurityGroupIds"),
      clientSecurityGroupIds: list("clientSecurityGroupIds"),
      kafkaPort: Number(app.node.tryGetContext("kafkaPort") ?? "9094"),
      healthPort: Number(app.node.tryGetContext("healthPort") ?? "8050"),
      healthPath: String(app.node.tryGetContext("healthPath") ?? "/metrics"),
    },
  });
} else {
  const config = loadConfig(app);
  const prefix = `${deploymentPrefix(config.envName)}-cell-${config.cellId}`;
  tagDeployment(app, config.envName);

  const network = new NetworkStack(app, `${prefix}-network`, { env, vpcId: config.vpcId });
  new CoreCellStack(app, `${prefix}-host`, { env, vpc: network.vpc, config });
}
