#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { loadConfig } from "../lib/config";
import { ObservabilityStack } from "../lib/observability-stack";
import { AlarmsStack } from "../lib/alarms-stack";
import { GrafanaStack } from "../lib/grafana-stack";
import { deploymentPrefix, tagDeployment } from "../lib/naming";

const app = new App();
const config = loadConfig(app);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };
const prefix = `${deploymentPrefix(config.envName)}-obs`;
tagDeployment(app, config.envName);

const core = new ObservabilityStack(app, `${prefix}-core`, { env, config });
if (config.grafanaService) {
  if (!core.workspace) throw new Error("grafanaService reads Managed Prometheus: it needs managedPrometheus=true");
  new GrafanaStack(app, `${prefix}-grafana`, { env, envName: config.envName, workspace: core.workspace, config: config.grafanaService });
}
new AlarmsStack(app, `${prefix}-alarms`, { env, config, pages: core.pages, warnings: core.warnings });
