#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { CoreCellStack } from "../lib/core-cell-stack";

const app = new App();
const config = loadConfig(app);
// The launch template CDK adds for requireImdsv2 is named "CellLaunchTemplate"
// in every stack unless this flag is on, and the name is unique per account and
// region, so a second cell could not be created. Set here as a boolean: a
// `-c flag=false` on the command line arrives as a string, which reads as on.
app.node.setContext("@aws-cdk/aws-ec2:uniqueImdsv2TemplateName", !config.legacyLaunchTemplateName);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoCell-${config.envName}-${config.cellId}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, vpcId: config.vpcId });
new CoreCellStack(app, `${prefix}-Host`, { env, vpc: network.vpc, config });
