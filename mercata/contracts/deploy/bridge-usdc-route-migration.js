/**
 * One-time MercataBridge stable route migration helper.
 *
 * Purpose:
 * 1) Set USDC default route to the STRATO USDC token via setAsset(...)
 * 2) Set USDT default route to the STRATO USDT token via setAsset(...)
 * 3) Enable USDC/USDT -> USDST alternate routes via setAssetRoute(...)
 *
 * Dry-run by default. Use --apply to execute transactions.
 *
 * Usage:
 *   node deploy/bridge-usdc-route-migration.js
 *   node deploy/bridge-usdc-route-migration.js --apply
 *
 * Options:
 *   --env <testnet|prod>         Environment profile (default: testnet)
 *   --apply                      Execute txs (otherwise print planned calls only)
 */
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

function getArgValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return "";
  const next = argv[idx + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return String(next);
}

function normalizeEnvProfile(value) {
  const v = String(value || "testnet").trim().toLowerCase();
  if (v === "prod" || v === "prodnet" || v === "mainnet") return "prod";
  return "testnet";
}

function applyEnvProfile(profile) {
  const normalized = normalizeEnvProfile(profile);
  process.env.NODE_URL =
    normalized === "prod"
      ? "https://app.strato.nexus"
      : "https://node1.testnet.strato.nexus";

  return normalized;
}

const ENV_PROFILE = applyEnvProfile(getArgValue(process.argv.slice(2), "--env"));

const { rest } = require("blockapps-rest");
const auth = require("./auth");
const config = require("./config");
const { callListAndWait } = require("./util");

const DEFAULT_BRIDGE_ADDRESS = "0000000000000000000000000000000000001008";
const DEFAULT_USDST_ADDRESS = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
const ZERO_UINT256 = "0000000000000000000000000000000000000000";
const ROUTE_TOKEN_SYMBOL_CANDIDATES = {
  USDC: ["USDC", "USDCST"],
  USDT: ["USDT", "USDTST"],
};
const PROFILE_CHAIN_IDS = {
  testnet: [11155111, 84532],
  prod: [1, 8453],
};

function normalizeAddress(value) {
  if (!value) return "";
  return String(value).toLowerCase().replace(/^0x/, "");
}

function parseBool(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1";
  }
  return false;
}

function parseArgs() {
  const parsed = { apply: false };
  const argv = process.argv.slice(2);
  const allowedWithValue = new Set(["env"]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    if (!allowedWithValue.has(key)) {
      throw new Error(`Unsupported option --${key}`);
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    i++;
  }

  return parsed;
}

async function getTokenObj() {
  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("GLOBAL_ADMIN_NAME and GLOBAL_ADMIN_PASSWORD are required");
  }

  const token = await auth.getUserToken(username, password);
  return { token };
}

async function searchTable(tokenObj, name, query) {
  const options = { config, query };
  const rows = await rest.search(tokenObj, { name }, options);
  return Array.isArray(rows) ? rows : [];
}

async function resolveTargetsBySymbol(tokenObj, bridgeAddress, envProfile, symbol) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  if (!normalizedSymbol) return [];

  const chainIds = PROFILE_CHAIN_IDS[envProfile] || PROFILE_CHAIN_IDS.testnet;
  const chainCsv = chainIds.join(",");

  let rows = [];
  try {
    rows = await searchTable(tokenObj, "BlockApps-MercataBridge-assets", {
      address: `eq.${bridgeAddress}`,
      key2: `in.(${chainCsv})`,
      select: "key,key2,value,block_number",
      order: "block_number.asc",
      limit: "20000",
    });
  } catch {
    rows = await searchTable(tokenObj, "BlockApps-MercataBridge-mappings", {
      address: `eq.${bridgeAddress}`,
      collection_name: "eq.assets",
      key2: `in.(${chainCsv})`,
      select: "key,key2,value,block_number",
      order: "block_number.asc",
      limit: "20000",
    });
  }

  const latestByPair = new Map();
  for (const row of rows) {
    const externalChainId = Number(row.key2 ?? row.value?.externalChainId ?? 0);
    const externalToken = normalizeAddress(row.key || row.value?.externalToken);
    if (!externalChainId || !externalToken) continue;
    const key = `${externalChainId}:${externalToken}`;
    const currentBlock = Number(row.block_number || 0);
    const prev = latestByPair.get(key);
    if (!prev || currentBlock >= prev.blockNumber) {
      latestByPair.set(key, { row, blockNumber: currentBlock });
    }
  }

  const targets = [];
  for (const { row } of latestByPair.values()) {
    const value = row.value || {};
    const rowSymbol = String(value.externalSymbol || "").toUpperCase();
    if (rowSymbol !== normalizedSymbol) continue;

    const externalChainId = Number(row.key2 ?? value.externalChainId ?? 0);
    const externalToken = normalizeAddress(row.key || value.externalToken);
    const externalDecimals = Number(value.externalDecimals ?? 6);
    if (!externalChainId || !externalToken || Number.isNaN(externalDecimals)) continue;

    targets.push({
      externalChainId,
      externalToken,
      externalDecimals,
      externalName: String(value.externalName || normalizedSymbol),
      externalSymbol: String(value.externalSymbol || normalizedSymbol),
      enabled: parseBool(value.enabled),
      maxPerWithdrawal: String(value.maxPerWithdrawal || ZERO_UINT256),
    });
  }

  targets.sort((a, b) => {
    if (a.externalChainId !== b.externalChainId) {
      return a.externalChainId - b.externalChainId;
    }
    return a.externalToken.localeCompare(b.externalToken);
  });

  return targets;
}

async function resolveActiveTokenBySymbol(tokenObj, symbol) {
  const rows = await searchTable(tokenObj, "BlockApps-Token", {
    _symbol: `eq.${symbol}`,
    status: "eq.2",
    _erc20Initialized: "eq.true",
    select: "address,block_number",
    order: "block_number.desc",
    limit: "200",
  });

  if (!rows.length) return "";

  const sorted = rows
    .map((row) => ({
      address: normalizeAddress(row.address),
      blockNumber: Number(row.block_number || 0),
    }))
    .filter((row) => row.address);

  if (!sorted.length) return "";
  sorted.sort((a, b) => b.blockNumber - a.blockNumber);
  return sorted[0].address;
}

async function resolveActiveTokenBySymbols(tokenObj, symbols) {
  const seen = new Set();
  for (const candidate of symbols) {
    const normalized = String(candidate || "").trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const address = await resolveActiveTokenBySymbol(tokenObj, normalized);
    if (address) {
      return { symbol: normalized, address };
    }
  }

  return { symbol: "", address: "" };
}

function buildSetAssetCall(bridgeAddress, target, usdcstToken) {
  return {
    contract: { address: bridgeAddress, name: "MercataBridge" },
    method: "setAsset",
    args: {
      enabled: !!target.enabled,
      externalChainId: Number(target.externalChainId),
      externalDecimals: Number(target.externalDecimals),
      externalName: target.externalName,
      externalSymbol: target.externalSymbol,
      externalToken: normalizeAddress(target.externalToken),
      maxPerWithdrawal: String(target.maxPerWithdrawal),
      stratoToken: usdcstToken,
    },
    txParams: {
      gasPrice: config.gasPrice,
      gasLimit: config.gasLimit,
    },
  };
}

function buildSetAssetRouteCall(bridgeAddress, target, usdstToken) {
  return {
    contract: { address: bridgeAddress, name: "MercataBridge" },
    method: "setAssetRoute",
    args: {
      externalToken: normalizeAddress(target.externalToken),
      externalChainId: Number(target.externalChainId),
      targetStratoToken: usdstToken,
      enabled: true,
    },
    txParams: {
      gasPrice: config.gasPrice,
      gasLimit: config.gasLimit,
    },
  };
}

async function main() {
  const args = parseArgs();
  const bridgeAddress = normalizeAddress(DEFAULT_BRIDGE_ADDRESS);
  const targetSymbols = ["USDC", "USDT"];
  const defaultRouteTokenBySymbol = {};
  const selectedRouteTokenSymbolByExternalSymbol = {};
  const usdstToken = normalizeAddress(DEFAULT_USDST_ADDRESS);
  const apply = !!args.apply;

  if (!bridgeAddress) throw new Error("Invalid hardcoded bridge address");
  if (!usdstToken) throw new Error("Invalid hardcoded USDST address");

  const tokenObj = await getTokenObj();

  for (const symbol of targetSymbols) {
    const candidateSymbols = ROUTE_TOKEN_SYMBOL_CANDIDATES[symbol] || [symbol];
    const resolvedRouteToken = await resolveActiveTokenBySymbols(tokenObj, candidateSymbols);
    if (!resolvedRouteToken.address) {
      throw new Error(
        `${candidateSymbols.join(" or ")} not found as active token in Cirrus. Create/activate token first.`,
      );
    }
    defaultRouteTokenBySymbol[symbol] = resolvedRouteToken.address;
    selectedRouteTokenSymbolByExternalSymbol[symbol] = resolvedRouteToken.symbol;
  }

  const targetsBySymbol = {};
  for (const symbol of targetSymbols) {
    targetsBySymbol[symbol] = await resolveTargetsBySymbol(
      tokenObj,
      bridgeAddress,
      ENV_PROFILE,
      symbol,
    );
    if (!targetsBySymbol[symbol].length) {
      throw new Error(`No ${symbol} bridge assets found for env ${ENV_PROFILE}`);
    }
  }

  const plannedCalls = [];
  for (const symbol of targetSymbols) {
    const routeToken = defaultRouteTokenBySymbol[symbol];
    for (const target of targetsBySymbol[symbol]) {
      plannedCalls.push(buildSetAssetCall(bridgeAddress, target, routeToken));
      if (target.enabled) {
        plannedCalls.push(buildSetAssetRouteCall(bridgeAddress, target, usdstToken));
      }
    }
  }

  console.log("=== MercataBridge USDC/USDT Migration Plan ===");
  console.log(
    JSON.stringify(
      {
        nodeUrl: config.nodes?.[0]?.url || null,
        env: ENV_PROFILE,
        bridgeAddress,
        defaultRouteTokenBySymbol,
        selectedRouteTokenSymbolByExternalSymbol,
        usdstToken,
        apply,
        targetsBySymbol,
        plannedCallCount: plannedCalls.length,
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to execute.");
    console.log("Planned calls:");
    console.log(JSON.stringify(plannedCalls, null, 2));
    return;
  }

  const results = await callListAndWait(plannedCalls);
  console.log("\nExecution results:");
  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("bridge-usdc-route-migration failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  main,
};
