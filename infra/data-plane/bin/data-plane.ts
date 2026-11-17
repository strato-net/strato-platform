#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { PostgresStack } from "../lib/postgres-stack";
import { deploymentPrefix, tagDeployment } from "../lib/naming";

const app = new App();
const c = (key: string, fallback?: string): string => {
  const v = app.node.tryGetContext(key);
  if (v !== undefined && v !== null && v !== "") return String(v);
  if (fallback === undefined) throw new Error(`missing context value: ${key} (pass -c ${key}=...)`);
  return fallback;
};
const list = (key: string): string[] => c(key, "").split(",").map((s) => s.trim()).filter(Boolean);
const envName = c("envName", "testnet");
const prefix = deploymentPrefix(envName);
tagDeployment(app, envName);

new PostgresStack(app, `${prefix}-data-postgres`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  envName,
  vpcId: c("vpcId", "") || undefined,
  engineVersion: c("engineVersion", "14.15"),
  writerInstanceClass: c("writerInstanceClass", "r7g.large"),
  readerInstanceClass: c("readerInstanceClass", "r7g.large"),
  readerCount: Number(c("readerCount", "2")),
  clientSecurityGroupIds: list("clientSecurityGroupIds"),
  clientCidrs: list("clientCidrs"),
  secretName: c("secretName", `${prefix}/postgres`),
  nodeLogin: c("nodeLogin", "strato"),
  nodeLoginSecretName: c("nodeLoginSecretName", `${prefix}/postgres/node`),
  terminationProtection: true,
});
