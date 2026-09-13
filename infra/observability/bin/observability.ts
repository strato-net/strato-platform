#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { ObservabilityStack } from "../lib/observability-stack";
import { AlarmsStack } from "../lib/alarms-stack";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoObs-${config.envName}`;

const core = new ObservabilityStack(app, `${prefix}-Core`, { env, config });
new AlarmsStack(app, `${prefix}-Alarms`, { env, config, pages: core.pages, warnings: core.warnings });
