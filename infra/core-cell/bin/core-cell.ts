#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { CoreCellStack } from "../lib/core-cell-stack";
import { deploymentPrefix, tagDeployment } from "../lib/naming";

const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const config = loadConfig(app);
const prefix = `${deploymentPrefix(config.envName)}-cell-${config.cellId}`;
tagDeployment(app, config.envName);

const network = new NetworkStack(app, `${prefix}-network`, { env, vpcId: config.vpcId });
new CoreCellStack(app, `${prefix}-host`, { env, vpc: network.vpc, config });
