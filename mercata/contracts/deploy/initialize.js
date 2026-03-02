/**
 * Batch initialize script for BlockApps contracts.
 *
 * Flow per target:
 * 1) Read state from /BlockApps-{contractName} (Cirrus table)
 * 2) Keep the state in memory for traceability
 * 3) Call initialize() with args from INITIALIZE_ARGS_MAP
 */
require("dotenv").config();
const config = require("./config");
const auth = require("./auth");
const { rest } = require("blockapps-rest");

// Targets to initialize.
// Pattern: { address: "<proxy-or-contract-address>", contractName: "<ContractName>" }
const TARGETS = [
// { address: "0000000000000000000000000000000000001017", contractName: "Pool" },
];

// Optional initialize args overrides the developer can populate.
// Key can be either target address OR contract name.
// Address key wins over contract-name key when both exist.
// If no override exists, args are derived from pulled state where supported.
const INITIALIZE_ARGS_MAP = {
  // "abc123...": { tokenAAddr: "...", tokenBAddr: "...", lpTokenAddr: "..." },
  // "Pool": { tokenAAddr: "...", tokenBAddr: "...", lpTokenAddr: "..." },
};

function printUsage() {
  console.error("Usage: node initialize.js");
  console.error("");
  console.error("This script uses hardcoded TARGETS and INITIALIZE_ARGS_MAP.");
  console.error("Populate both in deploy/initialize.js before running.");
  console.error("");
  console.error("Required environment variables (.env):");
  console.error("  OAUTH_CLIENT_SECRET, OAUTH_CLIENT_ID, OAUTH_URL, NODE_URL, GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD");
}

async function fetchContractStateFromTable(tokenObj, contractName, address) {
  const tableName = `BlockApps-${contractName}`;
  const baseUrl = config.nodes[0].url.replace(/\/$/, "");
  const params = new URLSearchParams({
    address: `eq.${address}`,
    limit: "1",
  });
  const url = `${baseUrl}/cirrus/search/${encodeURIComponent(tableName)}?${params.toString()}`;

  // Match backend pattern: explicit Bearer auth on Cirrus GET.
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenObj.token}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Cirrus state query failed (${response.status}) for /${tableName} address ${address}: ${body}`
    );
  }

  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No row found in /${tableName} for address ${address}`);
  }
  console.log("rows", rows[0]);
  return rows[0];
  
}

async function pullTargetState(tokenObj, target) {
  const { address, contractName } = target;
  const state = await fetchContractStateFromTable(tokenObj, contractName, address);
  return {
    address,
    contractName,
    stateSnapshot: state,
  };
}

function buildInitializeArgsFromState(target, stateSnapshot) {
  const { contractName } = target;

  if (contractName === "Pool") {
    const tokenAAddr = stateSnapshot.tokenA;
    const tokenBAddr = stateSnapshot.tokenB;
    const lpTokenAddr = stateSnapshot.lpToken;
    if (!tokenAAddr || !tokenBAddr || !lpTokenAddr) {
      throw new Error(
        `Cannot derive Pool initialize args from state. Missing one of tokenA/tokenB/lpToken for ${target.address}.`
      );
    }
    return { tokenAAddr, tokenBAddr, lpTokenAddr, poolFactoryAddr: "0000000000000000000000000000000000000100a" };
  }

  throw new Error(
    `No derived initialize args rule for contract ${contractName}. Add INITIALIZE_ARGS_MAP["${target.address}"] or INITIALIZE_ARGS_MAP["${contractName}"].`
  );
}

function getInitializeArgs(target, stateSnapshot) {
  const overrideArgs = INITIALIZE_ARGS_MAP[target.address] || INITIALIZE_ARGS_MAP[target.contractName];
  if (overrideArgs) {
    return overrideArgs;
  }
  return buildInitializeArgsFromState(target, stateSnapshot);
}

async function initializeTarget(tokenObj, target, initializeArgs) {
  const { address, contractName } = target;
  const callArgs = {
    contract: { address, name: contractName },
    method: "initialize",
    args: initializeArgs,
    txParams: {
      gasPrice: config.gasPrice,
      gasLimit: config.gasLimit,
    },
  };
  const callOptions = {
    config,
    cacheNonce: true,
  };

  const callResult = await rest.call(tokenObj, callArgs, callOptions);
  return {
    address,
    contractName,
    initializeArgs,
    callResult,
  };
}

async function main() {
  try {
    console.log("Starting batch initialize process...");
    console.log("=====================================\n");

    const requiredVars = [
      "GLOBAL_ADMIN_NAME",
      "GLOBAL_ADMIN_PASSWORD",
      "OAUTH_CLIENT_SECRET",
      "OAUTH_CLIENT_ID",
      "OAUTH_URL",
      "NODE_URL",
    ];
    const missingVars = requiredVars.filter((v) => !process.env[v]);
    if (missingVars.length > 0) {
      console.error(`Missing required environment variables: ${missingVars.join(", ")}\n`);
      printUsage();
      process.exit(1);
    }

    if (!Array.isArray(TARGETS) || TARGETS.length === 0) {
      throw new Error("TARGETS is empty. Add at least one target before running initialize.js.");
    }

    const invalidTargets = TARGETS.filter((t) => !t || !t.address || !t.contractName);
    if (invalidTargets.length > 0) {
      throw new Error("Each target must include both { address, contractName }.");
    }

    const username = process.env.GLOBAL_ADMIN_NAME;
    const password = process.env.GLOBAL_ADMIN_PASSWORD;

    console.log(`Authenticating as ${username}...`);
    const token = await auth.getUserToken(username, password);
    const tokenObj = { token };
    console.log(`Authenticated as ${username}`);
    console.log(`Targets: ${TARGETS.length}\n`);

    // Keep fetched state in memory keyed by target address.
    const stateByAddress = {};
    const results = [];

    for (let i = 0; i < TARGETS.length; i++) {
      const target = TARGETS[i];
      const { address, contractName } = target;
      console.log(`--- [${i + 1}/${TARGETS.length}] ${contractName} @ ${address} ---`);

      // 1) Pull state from /BlockApps-{contractName}
      const pulledState = await pullTargetState(tokenObj, target);
      stateByAddress[address] = pulledState.stateSnapshot;
      console.log(`Loaded state from /BlockApps-${contractName}`);

      // 2) Read initialize args from developer-populated args map
      const initializeArgs = getInitializeArgs(target, pulledState.stateSnapshot);

      // DEBUG: log args (initialize call commented out)
      console.log("initializeArgs:", JSON.stringify(initializeArgs, null, 2));

      // 3) Call initialize()
      const initialized = await initializeTarget(tokenObj, target, initializeArgs);
      console.log(`initialize() submitted for ${address}\n`);

      results.push({
        address,
        contractName,
        initializeArgs,
        stateSnapshot: pulledState.stateSnapshot,
      });
    }

    console.log("====== Batch Initialize Complete ======");
    console.log(`Initialized targets: ${results.length}`);
    console.log("=======================================\n");

    return { stateByAddress, results };
  } catch (error) {
    console.error("\nInitialize failed:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}

module.exports = {
  main,
  fetchContractStateFromTable,
  pullTargetState,
  initializeTarget,
  getInitializeArgs,
};
