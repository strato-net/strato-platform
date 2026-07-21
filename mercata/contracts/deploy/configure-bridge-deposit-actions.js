/**
 * Configure AUTO_FORGE and AUTO_SAVE availability for USDC/USDT bridge routes.
 *
 * Dry run:
 *   node configure-bridge-deposit-actions.js --env testnet
 *   node configure-bridge-deposit-actions.js --env prod
 *
 * Execute:
 *   node configure-bridge-deposit-actions.js --env testnet --execute
 *
 * Disable:
 *   node configure-bridge-deposit-actions.js --env testnet --operation disable --execute
 */
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const PROFILE_CONFIG = {
  testnet: {
    nodeUrl: "https://node1.testnet.strato.nexus",
    routes: [
      {
        symbol: "USDC",
        externalToken: "036cbd53842c5426634e7929541ec2318f3dcf7e",
        externalChainId: 84532,
        targetStratoToken: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
      },
      {
        symbol: "USDC",
        externalToken: "1c7d4b196cb0c7b01d743fbc6116a902379c7238",
        externalChainId: 11155111,
        targetStratoToken: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
      },
      {
        symbol: "USDC",
        externalToken: "94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8",
        externalChainId: 11155111,
        targetStratoToken: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
      },
      {
        symbol: "USDT",
        externalToken: "aa8e23fb1079ea71e0a56f48a2aa51851d8433d0",
        externalChainId: 11155111,
        targetStratoToken: "5ed0bdfb378ac0d06249d70759536d7a41906216",
      },
    ],
  },
  prod: {
    nodeUrl: "https://app.strato.nexus",
    routes: [
      {
        symbol: "USDC",
        externalToken: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        externalChainId: 1,
        targetStratoToken: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
      },
      {
        symbol: "USDC",
        externalToken: "833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        externalChainId: 8453,
        targetStratoToken: "6aeacaa19c68e53035bf495d15e0a328fc600ba8",
      },
      {
        symbol: "USDT",
        externalToken: "dac17f958d2ee523a2206206994597c13d831ec7",
        externalChainId: 1,
        targetStratoToken: "5ed0bdfb378ac0d06249d70759536d7a41906216",
      },
    ],
  },
};

const DEFAULT_BRIDGE_ADDRESS = "0000000000000000000000000000000000001008";
const ACTIONS = [
  { id: 2, name: "AUTO_FORGE" },
  { id: 3, name: "AUTO_SAVE" },
];

function parseArgs() {
  const parsed = { operation: "enable", execute: false };
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[arg.slice(2)] = value;
    i++;
  }

  if (!PROFILE_CONFIG[parsed.env]) {
    throw new Error("--env must be testnet or prod");
  }
  if (!["enable", "disable"].includes(parsed.operation)) {
    throw new Error("--operation must be enable or disable");
  }
  return parsed;
}

function normalizeAddress(value, label) {
  const normalized = String(value || "").replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 20-byte hex address`);
  }
  return normalized;
}

async function callAndWait(tokenObj, address, args, config, rest, util) {
  const response = await rest.call(
    tokenObj,
    {
      contract: { address, name: "MercataBridge" },
      method: "setDepositAction",
      args,
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    { config, cacheNonce: true, isAsync: true },
  );
  const responses = Array.isArray(response) ? response : [response];
  const hashes = responses.map((item) => item?.hash).filter(Boolean);
  if (!hashes.length) {
    throw new Error("MercataBridge.setDepositAction returned no transaction hash");
  }

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
    throw new Error(
      `MercataBridge.setDepositAction failed: ${JSON.stringify(final || results)}`,
    );
  }
  return final;
}

async function main() {
  const args = parseArgs();
  const profile = PROFILE_CONFIG[args.env];
  process.env.NODE_URL = profile.nodeUrl;

  const bridgeAddress = normalizeAddress(
    args["bridge-address"] || DEFAULT_BRIDGE_ADDRESS,
    "bridge-address",
  );
  const enabled = args.operation === "enable";
  const plan = profile.routes.flatMap((route) =>
    ACTIONS.map((action) => ({
      symbol: route.symbol,
      contract: bridgeAddress,
      method: "setDepositAction",
      args: {
        externalToken: normalizeAddress(route.externalToken, "externalToken"),
        externalChainId: route.externalChainId,
        targetStratoToken: normalizeAddress(
          route.targetStratoToken,
          "targetStratoToken",
        ),
        action: action.id,
        enabled,
      },
      actionName: action.name,
    })),
  );

  console.log(JSON.stringify({
    environment: args.env,
    nodeUrl: profile.nodeUrl,
    operation: args.operation,
    callCount: plan.length,
    plan,
  }, null, 2));

  if (!args.execute) {
    console.log("Dry run only. Re-run with --execute to submit these calls.");
    return;
  }

  const required = [
    "GLOBAL_ADMIN_NAME",
    "GLOBAL_ADMIN_PASSWORD",
    "OAUTH_CLIENT_SECRET",
    "OAUTH_CLIENT_ID",
    "OAUTH_URL",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  const config = require("./config");
  const auth = require("./auth");
  const { rest, util } = require("blockapps-rest");
  const token = await auth.getUserToken(
    process.env.GLOBAL_ADMIN_NAME,
    process.env.GLOBAL_ADMIN_PASSWORD,
  );
  const tokenObj = { token };

  for (const call of plan) {
    const result = await callAndWait(
      tokenObj,
      call.contract,
      call.args,
      config,
      rest,
      util,
    );
    console.log(
      `${call.symbol} ${call.actionName}: submitted successfully (${result.hash})`,
    );
  }

  console.log(
    "If governance approval is required, repeat the same typed calls as the remaining admins.",
  );
}

main().catch((error) => {
  console.error("configure-bridge-deposit-actions failed:", error.message);
  process.exit(1);
});
