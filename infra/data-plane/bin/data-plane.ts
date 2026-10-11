#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { PostgresStack } from "../lib/postgres-stack";
import { BusStack } from "../lib/bus-stack";
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

const postgres = new PostgresStack(app, `${prefix}-data-postgres`, {
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
  terminationProtection: true,
});

// The message bus shares the Postgres stack's VPC.
if (c("bus", "true") === "true") {
  new BusStack(app, `${prefix}-data-bus`, {
    env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
    envName,
    vpc: postgres.vpc,
    kafkaVersion: c("kafkaVersion", "3.6.0"),
    brokerInstanceType: c("busBrokerInstanceType", "kafka.m5.large"),
    brokerCount: Number(c("busBrokerCount", "2")),
    volumeSizeGb: Number(c("busVolumeSizeGb", "100")),
    clientSecurityGroupIds: list("clientSecurityGroupIds"),
    clientCidrs: list("clientCidrs"),
    terminationProtection: true,
  });
}
