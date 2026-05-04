import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { LoadTestConfig, SubmitMode } from "./types";

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
        submitMode: "sequential",
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
        submitMode: "sequential",
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
        submitMode: "sequential",
        ...raw.scenarios?.mixedWorkload,
      },
      multiNode: {
        enabled: false,
        ...raw.scenarios?.multiNode,
      },
      tokenSale: {
        enabled: false,
        totalTxCount: 1000,
        timeWindowMs: 30000,
        concurrentUsers: 50,
        networkLabel: "helium",
        chainId: 114784819836269,
        externalChainId: "11155111", // Ethereum Sepolia (testnet) — set to "1" for mainnet
        // `bridge` and `metalTokenAddress` MUST be supplied in user config —
        // there is no sensible default for the funded EOA / DepositRouter /
        // GOLDST. `bridge` is typed as required, but the YAML loader merges
        // user config over this `undefined` placeholder; if the user omits
        // `bridge:` the scenario throws at run() validation with a clear
        // message.
        bridge: undefined as any,
        metalTokenAddress: "",
        payTokenAddress: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010", // helium USDST
        metalForgeAddress: "c5ed981b816a626981a5747d125e0e7296b2c7c6", // helium MetalForge
        includePageLoad: true,
        logBalances: "summary",
        requestRetries: 3,
        autoForgeWaitTimeoutSec: 300,
        autoForgeWaitPollIntervalSec: 5,
        ...raw.scenarios?.tokenSale,
      },
      forgeBuy: {
        enabled: false,
        totalTxCount: 1000,
        timeWindowMs: 30000,
        concurrentUsers: 50,
        networkLabel: "helium",
        chainId: 114784819836269,
        // `metalTokenAddress` MUST be supplied in user config — no sensible
        // default for GOLDST.
        metalTokenAddress: "",
        payTokenAddress: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010", // helium USDST
        payAmount: "1000000000000000", // 0.001 USDST per iteration
        minMetalOut: "0",
        metalForgeAddress: "c5ed981b816a626981a5747d125e0e7296b2c7c6", // helium MetalForge
        includePageLoad: true,
        logBalances: "summary",
        requestRetries: 3,
        ...raw.scenarios?.forgeBuy,
      },
    },
    report: { ...DEFAULTS.report!, ...raw.report },
  };

  return config;
}

export interface CliOverrides {
  batchSize?: number;
  batchCount?: number;
  scenario?: string;
  nodes?: string[];
  reportDir?: string;
  submitMode?: SubmitMode;
  concurrentUsers?: number;
  totalTx?: number;
  timeWindow?: number;
  backendUrl?: string;
}

const KNOWN_SCENARIOS = new Set([
  "contractDeploy",
  "functionCall",
  "mixedWorkload",
  "tokenSale",
  "forgeBuy",
]);

export function applyCliOverrides(
  config: LoadTestConfig,
  overrides: CliOverrides,
): LoadTestConfig {
  if (overrides.batchSize !== undefined) {
    config.scenarios.contractDeploy.batchSize = overrides.batchSize;
    config.scenarios.functionCall.batchSize = overrides.batchSize;
    config.scenarios.mixedWorkload.batchSize = overrides.batchSize;
  }
  if (overrides.batchCount !== undefined) {
    config.scenarios.contractDeploy.batchCount = overrides.batchCount;
    config.scenarios.functionCall.batchCount = overrides.batchCount;
    config.scenarios.mixedWorkload.totalTxCount =
      overrides.batchCount * config.scenarios.mixedWorkload.batchSize;
  }
  if (overrides.scenario) {
    if (!KNOWN_SCENARIOS.has(overrides.scenario)) {
      throw new Error(
        `Unknown scenario: ${overrides.scenario}. Known: ${Array.from(KNOWN_SCENARIOS).join(", ")}`,
      );
    }
    // Disable all, then enable only the requested one
    for (const key of KNOWN_SCENARIOS) {
      (config.scenarios as any)[key].enabled = false;
    }
    (config.scenarios as any)[overrides.scenario].enabled = true;
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
  if (overrides.submitMode) {
    config.scenarios.contractDeploy.submitMode = overrides.submitMode;
    config.scenarios.functionCall.submitMode = overrides.submitMode;
    config.scenarios.mixedWorkload.submitMode = overrides.submitMode;
  }
  if (overrides.concurrentUsers !== undefined) {
    config.scenarios.tokenSale.concurrentUsers = overrides.concurrentUsers;
    config.scenarios.forgeBuy.concurrentUsers = overrides.concurrentUsers;
  }
  if (overrides.totalTx !== undefined) {
    config.scenarios.tokenSale.totalTxCount = overrides.totalTx;
    config.scenarios.forgeBuy.totalTxCount = overrides.totalTx;
  }
  if (overrides.timeWindow !== undefined) {
    config.scenarios.tokenSale.timeWindowMs = overrides.timeWindow;
    config.scenarios.forgeBuy.timeWindowMs = overrides.timeWindow;
  }
  if (overrides.backendUrl) {
    config.scenarios.tokenSale.backendUrl = overrides.backendUrl;
    config.scenarios.forgeBuy.backendUrl = overrides.backendUrl;
  }
  return config;
}
