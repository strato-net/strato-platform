/**
 * Build or submit every AdminRegistry-governed ExternalAssetBridge setup call.
 *
 * Usage:
 *   node configure-external-bridge.js --config <json> --step initialize|routes|actions [--execute]
 *
 * Dry-run is the default. Every run writes the full governance payload to JSON.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const config = require("./config");
const auth = require("./auth");
const { rest, util } = require("blockapps-rest");

const DEFAULT_ADMIN_REGISTRY =
  "000000000000000000000000000000000000100c";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { execute: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") {
      args.execute = true;
      continue;
    }
    if (!["--config", "--step"].includes(value)) {
      throw new Error(`Unsupported option ${value}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${value}`);
    }
    args[value.slice(2)] = next;
    index += 1;
  }
  if (!args.config) throw new Error("--config is required");
  if (!["initialize", "routes", "actions"].includes(args.step)) {
    throw new Error("--step must be initialize|routes|actions");
  }
  return args;
}

function address(value, label, { allowZero = false } = {}) {
  const normalized = String(value || "").replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  if (!allowZero && /^0{40}$/.test(normalized)) {
    throw new Error(`${label} must not be zero`);
  }
  return normalized;
}

function uint(value, label, { positive = false } = {}) {
  const normalized = String(value ?? "");
  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  if (positive && BigInt(normalized) === 0n) {
    throw new Error(`${label} must be positive`);
  }
  return normalized;
}

function bool(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

const parameter = (type, value) => ({ type, value });

function governanceCall(adminRegistry, target, func, args) {
  return {
    contract: adminRegistry,
    method: "castVoteOnIssue",
    args: { _target: target, _func: func, _args: args },
  };
}

function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  const input = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  const adminRegistry = address(
    input.adminRegistry || DEFAULT_ADMIN_REGISTRY,
    "adminRegistry",
  );
  const tokenRouter = {
    address: address(input.tokenRouter?.address, "tokenRouter.address"),
    poolFactory: address(
      input.tokenRouter?.poolFactory,
      "tokenRouter.poolFactory",
    ),
    poolV3Factory: address(
      input.tokenRouter?.poolV3Factory,
      "tokenRouter.poolV3Factory",
    ),
    directMintPsm: address(
      input.tokenRouter?.directMintPsm,
      "tokenRouter.directMintPsm",
    ),
    metalForge: address(
      input.tokenRouter?.metalForge,
      "tokenRouter.metalForge",
    ),
    saveUsdstVault: address(
      input.tokenRouter?.saveUsdstVault,
      "tokenRouter.saveUsdstVault",
    ),
    yieldVaults: (input.tokenRouter?.yieldVaults || []).map((item, index) =>
      address(item, `tokenRouter.yieldVaults[${index}]`),
    ),
  };
  const bridge = {
    address: address(
      input.externalAssetBridge?.address,
      "externalAssetBridge.address",
    ),
    tokenFactory: address(
      input.externalAssetBridge?.tokenFactory,
      "externalAssetBridge.tokenFactory",
    ),
    bridgeOperator: address(
      input.externalAssetBridge?.bridgeOperator,
      "externalAssetBridge.bridgeOperator",
    ),
    guardian: address(
      input.externalAssetBridge?.guardian,
      "externalAssetBridge.guardian",
    ),
    usdst: address(
      input.externalAssetBridge?.usdst,
      "externalAssetBridge.usdst",
    ),
    priceOracle: address(
      input.externalAssetBridge?.priceOracle,
      "externalAssetBridge.priceOracle",
    ),
  };
  const chains = (input.chains || []).map((chain, chainIndex) => ({
    chainName: String(chain.chainName || "").trim(),
    vault: address(chain.vault, `chains[${chainIndex}].vault`),
    depositRouter: address(
      chain.depositRouter,
      `chains[${chainIndex}].depositRouter`,
    ),
    enabled: bool(chain.enabled, `chains[${chainIndex}].enabled`),
    externalChainId: uint(
      chain.externalChainId,
      `chains[${chainIndex}].externalChainId`,
      { positive: true },
    ),
    lastProcessedBlock: uint(
      chain.lastProcessedBlock,
      `chains[${chainIndex}].lastProcessedBlock`,
    ),
    routes: (chain.routes || []).map((route, routeIndex) => {
      const prefix = `chains[${chainIndex}].routes[${routeIndex}]`;
      return {
        externalToken: address(route.externalToken, `${prefix}.externalToken`, {
          allowZero: true,
        }),
        stratoToken: address(route.stratoToken, `${prefix}.stratoToken`),
        depositsEnabled: bool(
          route.depositsEnabled,
          `${prefix}.depositsEnabled`,
        ),
        withdrawalsEnabled: bool(
          route.withdrawalsEnabled,
          `${prefix}.withdrawalsEnabled`,
        ),
        externalDecimals: uint(
          route.externalDecimals,
          `${prefix}.externalDecimals`,
        ),
        externalName: String(route.externalName || "").trim(),
        externalSymbol: String(route.externalSymbol || "").trim(),
        maxPerWithdrawal: uint(
          route.maxPerWithdrawal,
          `${prefix}.maxPerWithdrawal`,
        ),
        manualReviewThreshold: uint(
          route.manualReviewThreshold,
          `${prefix}.manualReviewThreshold`,
        ),
        rebaseRequired: bool(
          route.rebaseRequired ?? false,
          `${prefix}.rebaseRequired`,
        ),
        autoRouteEnabled: bool(
          route.autoRouteEnabled ?? false,
          `${prefix}.autoRouteEnabled`,
        ),
      };
    }),
  }));
  if (chains.some((chain) => !chain.chainName)) {
    throw new Error("chainName must not be empty");
  }
  if (
    chains.some((chain) =>
      chain.routes.some((route) => !route.externalName || !route.externalSymbol),
    )
  ) {
    throw new Error("route externalName/externalSymbol must not be empty");
  }
  return { absolutePath, adminRegistry, tokenRouter, bridge, chains };
}

function buildPlan(settings, step) {
  const { adminRegistry, tokenRouter, bridge, chains } = settings;
  const calls = [];
  const add = (target, func, args) =>
    calls.push(governanceCall(adminRegistry, target, func, args));

  if (step === "initialize") {
    add(tokenRouter.address, "initialize", [
      parameter("address", tokenRouter.poolFactory),
      parameter("address", tokenRouter.poolV3Factory),
      parameter("address", tokenRouter.directMintPsm),
      parameter("address", tokenRouter.metalForge),
      parameter("address", tokenRouter.saveUsdstVault),
    ]);
    tokenRouter.yieldVaults.forEach((vault) =>
      add(tokenRouter.address, "setYieldVault", [
        parameter("address", vault),
        parameter("bool", true),
      ]),
    );
    add(bridge.address, "initialize", [
      parameter("address", bridge.tokenFactory),
      parameter("address", bridge.bridgeOperator),
      parameter("address", bridge.guardian),
      parameter("address", bridge.usdst),
    ]);
    add(bridge.address, "setPriceOracle", [
      parameter("address", bridge.priceOracle),
    ]);
    add(bridge.address, "setTokenRouter", [
      parameter("address", tokenRouter.address),
    ]);
  }

  if (step === "routes") {
    chains.forEach((chain) => {
      add(bridge.address, "setChain", [
        parameter("string", chain.chainName),
        parameter("address", chain.vault),
        parameter("address", chain.depositRouter),
        parameter("bool", chain.enabled),
        parameter("uint256", chain.externalChainId),
        parameter("uint256", chain.lastProcessedBlock),
      ]);
      chain.routes.forEach((route) => {
        add(bridge.address, "setRoute", [
          parameter("address", route.externalToken),
          parameter("uint256", chain.externalChainId),
          parameter("address", route.stratoToken),
          parameter("bool", route.depositsEnabled),
          parameter("bool", route.withdrawalsEnabled),
          parameter("uint256", route.externalDecimals),
          parameter("string", route.externalName),
          parameter("string", route.externalSymbol),
          parameter("uint256", route.maxPerWithdrawal),
          parameter("uint256", route.manualReviewThreshold),
        ]);
        if (route.rebaseRequired) {
          add(bridge.address, "setRouteRebaseRequired", [
            parameter("address", route.externalToken),
            parameter("uint256", chain.externalChainId),
            parameter("address", route.stratoToken),
            parameter("bool", true),
          ]);
        }
      });
    });
  }

  if (step === "actions") {
    chains.forEach((chain) =>
      chain.routes
        .filter((route) => route.autoRouteEnabled)
        .forEach((route) =>
          add(bridge.address, "setDepositAction", [
            parameter("address", route.externalToken),
            parameter("uint256", chain.externalChainId),
            parameter("address", route.stratoToken),
            parameter("uint256", "4"),
            parameter("bool", true),
          ]),
        ),
    );
  }
  return calls;
}

async function submit(tokenObj, call) {
  const response = await rest.call(
    tokenObj,
    {
      contract: { address: call.contract, name: "AdminRegistry" },
      method: call.method,
      args: call.args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true, isAsync: true },
  );
  const hashes = (Array.isArray(response) ? response : [response])
    .map((item) => item?.hash)
    .filter(Boolean);
  if (!hashes.length) throw new Error("Governance vote returned no transaction hash");
  const results = await util.until(
    (items) =>
      Array.isArray(items) &&
      items.length > 0 &&
      items.every((item) => item?.status && item.status !== "Pending"),
    (options) => rest.getBlocResults(tokenObj, hashes, options),
    { config, isAsync: true },
    60000,
  );
  const final = Array.isArray(results) ? results[0] : results;
  if (!final || final.status !== "Success") {
    throw new Error(`Governance vote failed: ${JSON.stringify(final || results)}`);
  }
  return { transactionHash: final.hash, status: final.status };
}

function writeOutput(payload) {
  const directory = path.resolve(__dirname, "deployment-logs");
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    directory,
    `external-bridge-governance-${payload.step}-${timestamp}.json`,
  );
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  return outputPath;
}

async function main() {
  const args = parseArgs();
  const settings = loadConfig(args.config);
  const plan = buildPlan(settings, args.step);
  const output = {
    config: settings.absolutePath,
    step: args.step,
    execute: args.execute,
    adminRegistry: settings.adminRegistry,
    calls: plan,
    results: [],
  };
  if (args.execute) {
    const required = [
      "GLOBAL_ADMIN_NAME",
      "GLOBAL_ADMIN_PASSWORD",
      "OAUTH_CLIENT_SECRET",
      "OAUTH_CLIENT_ID",
      "OAUTH_URL",
      "NODE_URL",
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length) {
      throw new Error(`Missing environment variables: ${missing.join(", ")}`);
    }
    const token = await auth.getUserToken(
      process.env.GLOBAL_ADMIN_NAME,
      process.env.GLOBAL_ADMIN_PASSWORD,
    );
    for (const call of plan) {
      output.results.push({
        target: call.args._target,
        function: call.args._func,
        ...(await submit({ token }, call)),
      });
    }
  }
  const outputPath = writeOutput(output);
  console.log(JSON.stringify(output, null, 2));
  console.log(`Output: ${outputPath}`);
  if (!args.execute) {
    console.log("Dry run only. Re-run with --execute to submit governance votes.");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`configure-external-bridge failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, loadConfig, buildPlan };
