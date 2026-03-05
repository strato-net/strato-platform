const path = require("path");
require("dotenv").config();
require("dotenv").config({
  path: path.resolve(__dirname, "../../services/bridge/.env"),
});

const {
  getProfileFromArgv,
  applyEnvProfile,
} = require("./lib/envProfile");
const envProfile = applyEnvProfile(getProfileFromArgv(process.argv.slice(2)));
const { bootstrapAuthEnv } = require("./lib/bootstrapAuthEnv");
bootstrapAuthEnv();

const { ethers } = require("ethers");
const {
  initOpenIdConfig,
  getBAUserToken,
} = require(path.resolve(__dirname, "../../services/bridge/dist/auth/index.js"));
const {
  CHAIN_CONFIG,
  normalizeAddress,
  getChainConfig,
  getRpcUrl,
  loadDepositRouterArtifact,
  encodeCall,
  proposeBatch,
  chunkArray,
  writeOutput,
} = require("./lib/depositRouterSafeOps");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAPPINGS_TABLE = "BlockApps-MercataBridge-mappings";
const CHAINS_TABLE = "BlockApps-MercataBridge-chains";
const DEFAULT_BRIDGE_ADDRESS = "0x0000000000000000000000000000000000001008";

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { apply: false };
  const allowedWithValue = new Set(["env", "chains"]);

  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === "--apply") {
      args.apply = true;
      continue;
    }
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (!allowedWithValue.has(key)) {
      throw new Error(`Unsupported option --${key}`);
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    i++;
  }

  return args;
}

const CHAIN_NAME_TO_ID = {
  mainnet: 1,
  ethereum: 1,
  eth: 1,
  sepolia: 11155111,
  base: 8453,
  base_mainnet: 8453,
  base_main: 8453,
  base_sepolia: 84532,
  "base-sepolia": 84532,
  basesepolia: 84532,
};

function parseChains(args) {
  const value = args.chains || envProfile.defaultChainsCsv;
  if (!value) return [];
  const chainIds = String(value)
    .split(",")
    .map((v) => {
      const raw = String(v || "").trim().toLowerCase();
      if (!raw) return NaN;
      if (/^\d+$/.test(raw)) return Number(raw);
      return CHAIN_NAME_TO_ID[raw] || NaN;
    })
    .filter((v) => Number.isInteger(v) && CHAIN_CONFIG[v]);
  if (!chainIds.length) {
    throw new Error(`No valid chains in --chains ${String(value)}`);
  }
  return chainIds;
}

function normalizeHexAddress(value, { zeroIfEmpty = false } = {}) {
  if (value === null || value === undefined) return zeroIfEmpty ? ZERO_ADDRESS : "";
  const raw = String(value).trim().toLowerCase();
  if (!raw) return zeroIfEmpty ? ZERO_ADDRESS : "";
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (hex.length === 0) return zeroIfEmpty ? ZERO_ADDRESS : "";
  if (!/^[0-9a-f]{40}$/.test(hex)) return "";
  return `0x${hex}`;
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

function toBlockNumber(row) {
  return Number(row.block_number || row.blockNumber || 0);
}

function pairKey(chainId, externalToken) {
  return `${chainId}:${externalToken.toLowerCase()}`;
}

function routeKey(chainId, externalToken, targetStratoToken) {
  return `${chainId}:${externalToken.toLowerCase()}:${targetStratoToken.toLowerCase()}`;
}

async function cirrusSearch(nodeUrl, token, table, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }

  const url = `${nodeUrl}/cirrus/search/${table}?${query.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cirrus query failed (${response.status}): ${text.slice(0, 300)}`);
  }

  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

function isMissingRelationError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("relation") &&
    message.includes("does not exist")
  );
}

async function getCirrusAccessToken() {
  const token = String(process.env.ACCESS_TOKEN || "").trim();
  if (token) return token;
  await initOpenIdConfig();
  return getBAUserToken();
}

async function fetchBridgeMappingsFallback(nodeUrl, token, chains, bridgeAddressNo0x) {
  const chainCsv = chains.join(",");
  const assets = await cirrusSearch(nodeUrl, token, "BlockApps-MercataBridge-assets", {
    address: `eq.${bridgeAddressNo0x}`,
    key2: `in.(${chainCsv})`,
    select: "key,key2,value,block_number",
    order: "block_number.asc",
    limit: "20000",
  });

  let explicit = [];
  try {
    explicit = await cirrusSearch(nodeUrl, token, "BlockApps-MercataBridge-assetRouteEnabled", {
      address: `eq.${bridgeAddressNo0x}`,
      key2: `in.(${chainCsv})`,
      select: "key,key2,key3,value,block_number",
      order: "block_number.asc",
      limit: "20000",
    });
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    explicit = [];
  }

  return [
    ...assets.map((row) => ({ ...row, collection_name: "assets" })),
    ...explicit.map((row) => ({ ...row, collection_name: "assetRouteEnabled" })),
  ];
}

function parseChainRowChainId(row) {
  return Number(row.key ?? row.key2 ?? row.value?.externalChainId ?? 0);
}

function parseChainRowDepositRouter(row) {
  return normalizeHexAddress(row.value?.depositRouter);
}

function parseChainRowSafeAddress(row) {
  const value = row.value || {};
  const candidates = [
    value.custody,
    value.safeAddress,
    value.safe,
    value.safeWallet,
    value.gnosisSafe,
    value.multisig,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeHexAddress(candidate);
    if (normalized) return normalized;
  }
  return "";
}

async function fetchBridgeTopology(nodeUrl, token, chains) {
  const chainCsv = chains.join(",");
  const bridgeAddressFilter = DEFAULT_BRIDGE_ADDRESS.replace(/^0x/, "");

  let rows = [];
  try {
    rows = await cirrusSearch(nodeUrl, token, CHAINS_TABLE, {
      ...(bridgeAddressFilter ? { address: `eq.${bridgeAddressFilter}` } : {}),
      key: `in.(${chainCsv})`,
      select: "address,key,value,block_number",
      order: "block_number.asc",
      limit: "20000",
    });
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    rows = await cirrusSearch(nodeUrl, token, MAPPINGS_TABLE, {
      ...(bridgeAddressFilter ? { address: `eq.${bridgeAddressFilter}` } : {}),
      collection_name: "eq.chains",
      key2: `in.(${chainCsv})`,
      select: "address,key,key2,value,block_number",
      order: "block_number.asc",
      limit: "20000",
    });
  }

  if (!rows.length) {
    throw new Error("No MercataBridge chain rows found in Cirrus for selected chains");
  }

  const resolvedBridgeAddress = DEFAULT_BRIDGE_ADDRESS;
  if (!resolvedBridgeAddress) {
    throw new Error("Could not resolve MercataBridge address from Cirrus");
  }

  const latestRouterByChain = new Map();
  const latestSafeByChain = new Map();
  for (const row of rows) {
    const addr = normalizeHexAddress(row.address);
    if (addr !== resolvedBridgeAddress) continue;
    const chainId = parseChainRowChainId(row);
    if (!chains.includes(chainId)) continue;

    const safeAddress = parseChainRowSafeAddress(row);
    if (safeAddress) {
      const blockNumber = toBlockNumber(row);
      const prev = latestSafeByChain.get(chainId);
      if (!prev || blockNumber >= prev.blockNumber) {
        latestSafeByChain.set(chainId, {
          chainId,
          safeAddress,
          blockNumber,
        });
      }
    }

    const router = parseChainRowDepositRouter(row);
    if (!router) continue;
    const blockNumber = toBlockNumber(row);
    const prev = latestRouterByChain.get(chainId);
    if (!prev || blockNumber >= prev.blockNumber) {
      latestRouterByChain.set(chainId, {
        chainId,
        depositRouter: router,
        blockNumber,
      });
    }
  }

  const missingRouters = chains.filter((chainId) => !latestRouterByChain.has(chainId));
  if (missingRouters.length) {
    throw new Error(
      `Missing depositRouter addresses in Cirrus for chain(s): ${missingRouters.join(", ")}`,
    );
  }

  const missingSafes = chains.filter((chainId) => !latestSafeByChain.has(chainId));
  if (missingSafes.length) {
    throw new Error(
      `Missing Safe addresses in Cirrus for chain(s): ${missingSafes.join(", ")}`,
    );
  }

  return {
    bridgeAddress: resolvedBridgeAddress,
    routersByChain: new Map(
      Array.from(latestRouterByChain.values()).map((item) => [
        item.chainId,
        item.depositRouter,
      ]),
    ),
    safesByChain: new Map(
      Array.from(latestSafeByChain.values()).map((item) => [
        item.chainId,
        item.safeAddress,
      ]),
    ),
  };
}

async function fetchBridgeMappings(nodeUrl, token, chains, bridgeAddress) {
  const chainCsv = chains.join(",");
  const bridgeAddressNo0x = normalizeHexAddress(bridgeAddress).replace(/^0x/, "");

  try {
    const rows = await cirrusSearch(nodeUrl, token, MAPPINGS_TABLE, {
      address: `eq.${bridgeAddressNo0x}`,
      collection_name: "in.(assets,assetRouteEnabled)",
      key2: `in.(${chainCsv})`,
      select: "collection_name,key,key2,key3,value,block_number",
      order: "block_number.asc",
      limit: "20000",
    });
    return rows;
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    return fetchBridgeMappingsFallback(nodeUrl, token, chains, bridgeAddressNo0x);
  }
}

function buildSetterConfigFromMappings(rows, selectedChains) {
  const selected = new Set(selectedChains.map(Number));
  const latestAssetsByPair = new Map();
  const latestExplicitByRoute = new Map();

  for (const row of rows) {
    const collection = String(row.collection_name || "").trim();
    const chainId = Number(row.key2 ?? row.value?.externalChainId ?? 0);
    if (!selected.has(chainId)) continue;

    if (collection === "assets") {
      const externalToken =
        normalizeHexAddress(row.key, { zeroIfEmpty: true }) ||
        normalizeHexAddress(row.value?.externalToken, { zeroIfEmpty: true });
      const stratoToken = normalizeHexAddress(row.value?.stratoToken);
      if (!externalToken || !stratoToken) continue;

      const item = {
        chainId,
        externalToken,
        stratoToken,
        enabled: parseBool(row.value?.enabled),
        blockNumber: toBlockNumber(row),
      };

      const key = pairKey(chainId, externalToken);
      const prev = latestAssetsByPair.get(key);
      if (!prev || item.blockNumber >= prev.blockNumber) {
        latestAssetsByPair.set(key, item);
      }
      continue;
    }

    if (collection === "assetRouteEnabled") {
      const externalToken = normalizeHexAddress(row.key, { zeroIfEmpty: true });
      const targetStratoToken =
        normalizeHexAddress(row.key3) ||
        normalizeHexAddress(row.targetStratoToken) ||
        normalizeHexAddress(row.value?.targetStratoToken) ||
        normalizeHexAddress(row.value?.stratoToken);
      if (!externalToken || !targetStratoToken) continue;

      const mappingValue = row.mappingValue ?? row.value;
      const item = {
        chainId,
        externalToken,
        targetStratoToken,
        enabled: parseBool(mappingValue),
        blockNumber: toBlockNumber(row),
      };

      const key = routeKey(chainId, externalToken, targetStratoToken);
      const prev = latestExplicitByRoute.get(key);
      if (!prev || item.blockNumber >= prev.blockNumber) {
        latestExplicitByRoute.set(key, item);
      }
      continue;
    }
  }

  const routes = new Map();
  for (const asset of latestAssetsByPair.values()) {
    const key = routeKey(asset.chainId, asset.externalToken, asset.stratoToken);
    routes.set(key, {
      chainId: asset.chainId,
      externalToken: asset.externalToken,
      targetStratoToken: asset.stratoToken,
      enabled: asset.enabled,
    });
  }

  for (const explicitRoute of latestExplicitByRoute.values()) {
    const pKey = pairKey(explicitRoute.chainId, explicitRoute.externalToken);
    const asset = latestAssetsByPair.get(pKey);
    if (!asset) continue;
    const isDefaultRoute =
      asset.stratoToken.toLowerCase() ===
        explicitRoute.targetStratoToken.toLowerCase();

    const enabled = isDefaultRoute ? asset.enabled : explicitRoute.enabled;
    const key = routeKey(
      explicitRoute.chainId,
      explicitRoute.externalToken,
      explicitRoute.targetStratoToken,
    );

    routes.set(key, {
      chainId: explicitRoute.chainId,
      externalToken: explicitRoute.externalToken,
      targetStratoToken: explicitRoute.targetStratoToken,
      enabled,
    });
  }

  const byChain = {};
  for (const chainId of selectedChains) {
    byChain[chainId] = {
      setRoutePermitted: [],
    };
  }

  for (const route of routes.values()) {
    if (!route.enabled) continue;
    byChain[route.chainId].setRoutePermitted.push({
      token: route.externalToken,
      target: route.targetStratoToken,
      enabled: route.enabled,
    });
  }

  for (const chainId of selectedChains) {
    byChain[chainId].setRoutePermitted.sort((a, b) => {
      const tokenCmp = a.token.localeCompare(b.token);
      if (tokenCmp !== 0) return tokenCmp;
      return a.target.localeCompare(b.target);
    });
  }

  return byChain;
}

function buildTransactions(proxyAddress, chainConfig) {
  const txs = [];

  for (const row of chainConfig.setRoutePermitted || []) {
    txs.push({
      to: ethers.getAddress(proxyAddress),
      value: "0",
      data: encodeCall("setRoutePermitted", [
        ethers.getAddress(row.token),
        ethers.getAddress(row.target),
        !!row.enabled,
      ]),
      operation: 0,
      meta: {
        method: "setRoutePermitted",
        token: row.token,
        target: row.target,
        enabled: !!row.enabled,
      },
    });
  }

  return txs;
}

async function main() {
  const args = parseArgs();
  const chains = parseChains(args);
  if (!chains.length) throw new Error("No valid chains selected");

  const apply = !!args.apply;
  const chunkSize = 20;
  const nodeUrl = process.env.NODE_URL;
  if (!nodeUrl) {
    throw new Error("NODE_URL missing after env profile application");
  }

  const token = await getCirrusAccessToken();
  const topology = await fetchBridgeTopology(
    nodeUrl,
    token,
    chains
  );
  const mappingRows = await fetchBridgeMappings(
    nodeUrl,
    token,
    chains,
    topology.bridgeAddress,
  );
  const configByChain = buildSetterConfigFromMappings(mappingRows, chains);

  const summary = {
    env: envProfile.profile,
    nodeUrl,
    bridgeAddress: topology.bridgeAddress,
    safeSource: "cirrus",
    routerSource: "cirrus",
    apply,
    chunkSize,
    chains,
    mappingRowCount: mappingRows.length,
    operations: [],
  };

  for (const chainId of chains) {
    const cfg = getChainConfig(chainId);
    const chainConfig = configByChain[chainId];
    if (!chainConfig) {
      throw new Error(`Missing route config for chain ${chainId}`);
    }

    const proxyAddress = normalizeAddress(topology.routersByChain.get(chainId));
    if (!proxyAddress) throw new Error(`Missing proxy address for chain ${chainId}`);
    const safeAddress = normalizeAddress(topology.safesByChain.get(chainId));
    if (!safeAddress) throw new Error(`Missing Safe address for chain ${chainId}`);

    const artifact = loadDepositRouterArtifact();
    const provider = new ethers.JsonRpcProvider(getRpcUrl(chainId));
    const router = new ethers.Contract(proxyAddress, artifact.abi, provider);
    const owner = await router.owner();
    const ownerIsSafe = normalizeAddress(owner) === normalizeAddress(safeAddress);

    const txs = buildTransactions(proxyAddress, chainConfig);
    const chunks = chunkArray(txs, chunkSize);

    const chainResult = {
      chainId,
      chainName: cfg.name,
      proxyAddress,
      safeAddress,
      owner,
      ownerIsSafe,
      routeCount: chainConfig.setRoutePermitted.length,
      queuedCallCount: txs.length,
      proposals: [],
      warning: ownerIsSafe ? null : "Proxy owner is not the Safe address",
    };

    if (apply) {
      if (!ownerIsSafe) {
        throw new Error(
          `Chain ${chainId}: proxy owner (${owner}) is not Safe (${safeAddress}); cannot safely propose setter txs`,
        );
      }

      let nonceCursor = null;
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i].map((tx) => ({
          to: tx.to,
          value: tx.value,
          data: tx.data,
          operation: tx.operation,
        }));

        const proposal = await proposeBatch(
          chainId,
          chunk,
          {
            safeAddress,
            nonce: Number.isInteger(nonceCursor) ? nonceCursor : undefined,
          },
        );

        nonceCursor = proposal.nonce + 1;

        chainResult.proposals.push({
          batchIndex: i,
          txCount: chunk.length,
          nonce: proposal.nonce,
          safeTxHash: proposal.safeTxHash,
        });
      }
    } else {
      chainResult.preview = chunks.map((chunk, idx) => ({
        batchIndex: idx,
        txCount: chunk.length,
        calls: chunk.map((tx) => tx.meta),
      }));
    }

    summary.operations.push(chainResult);
  }

  const outputPath = writeOutput("deposit-router-setters", summary);
  console.log("=== DepositRouter Setter Queue Plan ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Output: ${outputPath}`);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to submit Safe proposals.");
  }
}

main().catch((error) => {
  console.error("depositRouterQueueSetters failed:", error.message);
  process.exit(1);
});
