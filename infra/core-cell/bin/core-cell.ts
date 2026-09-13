#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { CoreCellStack } from "../lib/core-cell-stack";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoCell-${config.envName}-${config.cellId}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, vpcId: config.vpcId });
new CoreCellStack(app, `${prefix}-Host`, { env, vpc: network.vpc, config });
