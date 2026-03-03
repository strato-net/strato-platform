import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { LoadTestConfig } from "./types";

const DEFAULTS: Partial<LoadTestConfig> = {
  gas: { limit: 32100000000, price: 1 },
  polling: { interval: 2000, timeout: 120000 },
  report: { outputDir: "./reports", formats: ["json", "html"] },
};

export function loadConfig(configPath: string): LoadTestConfig {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = yaml.load(fs.readFileSync(resolved, "utf8")) as any;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid config: must be a YAML object");
  }

  // Validate required fields
  if (!raw.nodes || !Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error("Config must include at least one node");
  }

  for (const [i, node] of raw.nodes.entries()) {
    if (!node.url) throw new Error(`Node ${i} missing 'url'`);
    if (!node.auth) throw new Error(`Node ${i} missing 'auth'`);
    if (!node.auth.openIdDiscoveryUrl) throw new Error(`Node ${i} missing 'auth.openIdDiscoveryUrl'`);
    if (!node.auth.clientId) throw new Error(`Node ${i} missing 'auth.clientId'`);
    if (!node.auth.clientSecret) throw new Error(`Node ${i} missing 'auth.clientSecret'`);
    if (!node.auth.username) throw new Error(`Node ${i} missing 'auth.username'`);
    if (!node.auth.password) throw new Error(`Node ${i} missing 'auth.password'`);
    node.name = node.name || `node-${i + 1}`;
  }

  const config: LoadTestConfig = {
    nodes: raw.nodes,
    gas: { ...DEFAULTS.gas!, ...raw.gas },
    polling: { ...DEFAULTS.polling!, ...raw.polling },
    scenarios: {
      contractDeploy: {
        enabled: false,
        batchSize: 10,
        batchCount: 5,
        batchDelay: 0,
        contractSource: "contracts/SimpleStorage.sol",
        contractName: "SimpleStorage",
        contractArgs: { _value: "42" },
        ...raw.scenarios?.contractDeploy,
      },
      functionCall: {
        enabled: false,
        batchSize: 20,
        batchCount: 10,
        batchDelay: 0,
        setupContract: "contracts/SimpleIncrement.sol",
        contractName: "SimpleIncrement",
        method: "increment",
        args: {},
        ...raw.scenarios?.functionCall,
      },
      mixedWorkload: {
        enabled: false,
        deployRatio: 0.3,
        totalTxCount: 100,
        batchSize: 10,
        ...raw.scenarios?.mixedWorkload,
      },
      multiNode: {
        enabled: false,
        ...raw.scenarios?.multiNode,
      },
    },
    report: { ...DEFAULTS.report!, ...raw.report },
  };

  return config;
}

export function applyCliOverrides(
  config: LoadTestConfig,
  overrides: {
    batchSize?: number;
    batchCount?: number;
    scenario?: string;
    nodes?: string[];
    reportDir?: string;
  },
): LoadTestConfig {
  if (overrides.batchSize !== undefined) {
    config.scenarios.contractDeploy.batchSize = overrides.batchSize;
    config.scenarios.functionCall.batchSize = overrides.batchSize;
    config.scenarios.mixedWorkload.batchSize = overrides.batchSize;
  }
  if (overrides.batchCount !== undefined) {
    config.scenarios.contractDeploy.batchCount = overrides.batchCount;
    config.scenarios.functionCall.batchCount = overrides.batchCount;
    // For mixed workload, adjust totalTxCount
    config.scenarios.mixedWorkload.totalTxCount =
      overrides.batchCount * config.scenarios.mixedWorkload.batchSize;
  }
  if (overrides.scenario) {
    // Disable all, then enable just the requested one
    config.scenarios.contractDeploy.enabled = false;
    config.scenarios.functionCall.enabled = false;
    config.scenarios.mixedWorkload.enabled = false;
    if (overrides.scenario === "contractDeploy") config.scenarios.contractDeploy.enabled = true;
    else if (overrides.scenario === "functionCall") config.scenarios.functionCall.enabled = true;
    else if (overrides.scenario === "mixedWorkload") config.scenarios.mixedWorkload.enabled = true;
    else throw new Error(`Unknown scenario: ${overrides.scenario}`);
  }
  if (overrides.nodes && overrides.nodes.length > 0) {
    config.nodes = config.nodes.filter((n) => overrides.nodes!.includes(n.name));
    if (config.nodes.length === 0) {
      throw new Error(`No matching nodes found for: ${overrides.nodes.join(", ")}`);
    }
  }
  if (overrides.reportDir) {
    config.report.outputDir = overrides.reportDir;
  }
  return config;
}
