#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig, loadCoreNlbConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { CoreCellStack } from "../lib/core-cell-stack";
import { CoreNlbStack } from "../lib/core-nlb-stack";
import { deploymentPrefix, tagDeployment } from "../lib/naming";

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

// -c coreNlb=true: the environment's load balancer in front of its cells,
// instead of a cell. There is one per environment, so it takes no cellId.
if (app.node.tryGetContext("coreNlb") === "true") {
  const config = loadCoreNlbConfig(app);
  tagDeployment(app, config.envName);
  new CoreNlbStack(app, `${deploymentPrefix(config.envName)}-core-nlb`, { env, config });
} else {
  const config = loadConfig(app);
  const prefix = `${deploymentPrefix(config.envName)}-cell-${config.cellId}`;
  tagDeployment(app, config.envName);

  const network = new NetworkStack(app, `${prefix}-network`, { env, vpcId: config.vpcId });
  new CoreCellStack(app, `${prefix}-host`, { env, vpc: network.vpc, config });
}
