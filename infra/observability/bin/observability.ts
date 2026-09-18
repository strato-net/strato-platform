#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { ObservabilityStack } from "../lib/observability-stack";
import { AlarmsStack } from "../lib/alarms-stack";
import { GrafanaStack } from "../lib/grafana-stack";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `StratoObs-${config.envName}`;

const core = new ObservabilityStack(app, `${prefix}-Core`, { env, config });
if (config.grafanaService) {
  if (!core.workspace) throw new Error("grafanaService reads Managed Prometheus: it needs managedPrometheus=true");
  new GrafanaStack(app, `${prefix}-Grafana`, { env, envName: config.envName, workspace: core.workspace, config: config.grafanaService });
}
new AlarmsStack(app, `${prefix}-Alarms`, { env, config, pages: core.pages, warnings: core.warnings });
