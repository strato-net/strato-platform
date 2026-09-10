#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { NetworkStack } from "../lib/network-stack";
import { ApiTierStack } from "../lib/api-tier-stack";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoApi-${config.envName}`;

const network = new NetworkStack(app, `${prefix}-Network`, { env, vpcId: config.vpcId });
new ApiTierStack(app, `${prefix}-Tier`, { env, vpc: network.vpc, config });
