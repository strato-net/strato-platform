#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { PostgresStack } from "../lib/postgres-stack";

const app = new App();
const c = (key: string, fallback?: string): string => {
  const v = app.node.tryGetContext(key);
  if (v !== undefined && v !== null && v !== "") return String(v);
  if (fallback === undefined) throw new Error(`missing context value: ${key} (pass -c ${key}=...)`);
  return fallback;
};
const list = (key: string): string[] => c(key, "").split(",").map((s) => s.trim()).filter(Boolean);
const envName = c("envName", "testnet");

new PostgresStack(app, `StratoData-${envName}-Postgres`, {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  envName,
  vpcId: c("vpcId", "") || undefined,
  engineVersion: c("engineVersion", "14.15"),
  writerInstanceClass: c("writerInstanceClass", "r7g.large"),
  readerInstanceClass: c("readerInstanceClass", "r7g.large"),
  readerCount: Number(c("readerCount", "2")),
  clientSecurityGroupIds: list("clientSecurityGroupIds"),
  clientCidrs: list("clientCidrs"),
  secretName: c("secretName", `strato/${envName}/postgres`),
  terminationProtection: true,
});
