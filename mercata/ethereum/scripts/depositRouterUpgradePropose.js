const path = require("path");
const { spawnSync } = require("child_process");
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
  writeOutput,
} = require("./lib/depositRouterSafeOps");

const MAPPINGS_TABLE = "BlockApps-MercataBridge-mappings";
const CHAINS_TABLE = "BlockApps-MercataBridge-chains";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DEFAULT_BRIDGE_ADDRESS = "0x0000000000000000000000000000000000001008";

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { apply: false };
  const allowedWithValue = new Set(["env"]);

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
    i++;
  }

  return args;
}

function parseChains() {
  const value = envProfile.defaultChainsCsv;
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && CHAIN_CONFIG[v]);
}

function getImplementationForChain(chainId) {
  const implEth = normalizeAddress(process.env.ROUTER_IMPL_ETH);
  const implBase = normalizeAddress(process.env.ROUTER_IMPL_BASE);
  if (chainId === 1 || chainId === 11155111) return implEth;
  if (chainId === 8453 || chainId === 84532) return implBase;
  return "";
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

function getHardhatNetwork(chainId) {
  if (chainId === 1) return "mainnet";
  if (chainId === 8453) return "base";
  if (chainId === 11155111) return "sepolia";
  if (chainId === 84532) return "baseSepolia";
  return "";
}

function verifyImplementation(chainId, implementationAddress) {
  const network = getHardhatNetwork(chainId);
  if (!network) {
    return {
      attempted: false,
      ok: false,
      reason: "unsupported-chain",
    };
  }

  const hardhatDir = path.resolve(__dirname, "..");
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    npxCmd,
    ["hardhat", "verify", "--network", network, implementationAddress],
    {
      cwd: hardhatDir,
      env: process.env,
      encoding: "utf8",
    },
  );

  if (result.error) {
    return {
      attempted: true,
      ok: false,
      network,
      error: String(result.error.message || result.error),
    };
  }

  if (result.status === 0) {
    return {
      attempted: true,
      ok: true,
      network,
    };
  }

  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return {
    attempted: true,
    ok: false,
    network,
    error: output.slice(0, 800),
  };
}

function toBlockNumber(row) {
  return Number(row.block_number || row.blockNumber || 0);
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
  return message.includes("relation") && message.includes("does not exist");
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

async function getCirrusAccessToken() {
  const token = String(process.env.ACCESS_TOKEN || "").trim();
  if (token) return token;
  await initOpenIdConfig();
  return getBAUserToken();
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

async function getProxyState(chainId, proxyAddress) {
  const artifact = loadDepositRouterArtifact();
  const provider = new ethers.JsonRpcProvider(getRpcUrl(chainId));
  const contract = new ethers.Contract(proxyAddress, artifact.abi, provider);
  const [owner, version, paused] = await Promise.all([
    contract.owner(),
    contract.version(),
    contract.paused(),
  ]);

  return {
    chainId,
    rpcUrl: getRpcUrl(chainId),
    proxyAddress,
    owner,
    version,
    paused,
  };
}

async function main() {
  const args = parseArgs();
  const chains = parseChains();
  if (!chains.length) throw new Error("No valid chains selected");

  const apply = !!args.apply;
  const nodeUrl = process.env.NODE_URL;
  if (!nodeUrl) throw new Error("NODE_URL missing after env profile application");
  const implEth = normalizeAddress(process.env.ROUTER_IMPL_ETH);
  const implBase = normalizeAddress(process.env.ROUTER_IMPL_BASE);
  if (!implEth) throw new Error("Missing ROUTER_IMPL_ETH in .env");
  if (!implBase) throw new Error("Missing ROUTER_IMPL_BASE in .env");
  const token = await getCirrusAccessToken();
  const topology = await fetchBridgeTopology(
    nodeUrl,
    token,
    chains
  );

  const summary = {
    env: envProfile.profile,
    nodeUrl,
    bridgeAddress: topology.bridgeAddress,
    routerSource: "cirrus",
    safeSource: "cirrus",
    apply,
    chains,
    operations: [],
  };

  for (const chainId of chains) {
    const cfg = getChainConfig(chainId);
    const proxyAddress = normalizeAddress(topology.routersByChain.get(chainId));
    if (!proxyAddress) throw new Error(`Missing proxy address for chain ${chainId}`);
    const safeAddress = normalizeAddress(topology.safesByChain.get(chainId));
    if (!safeAddress) throw new Error(`Missing Safe address for chain ${chainId}`);

    const state = await getProxyState(chainId, proxyAddress);
    const ownerIsSafe = normalizeAddress(state.owner) === normalizeAddress(safeAddress);
    const implementationAddress = getImplementationForChain(chainId);
    if (!implementationAddress) {
      throw new Error(`Chain ${chainId}: no implementation mapping`);
    }
    const chainOp = {
      chainId,
      chainName: cfg.name,
      proxyAddress,
      safeAddress,
      owner: state.owner,
      ownerIsSafe,
      version: state.version,
      paused: state.paused,
      implementationAddress,
      proposedUpgrade: false,
      safeTxHash: null,
      nonce: null,
      warning: ownerIsSafe ? null : "Proxy owner is not the Safe address",
    };

    const upgradeData = encodeCall("upgradeToAndCall", [
      ethers.getAddress(implementationAddress),
      "0x",
    ]);
    const tx = {
      to: ethers.getAddress(proxyAddress),
      value: "0",
      data: upgradeData,
      operation: 0,
    };

    if (apply) {
      if (!ownerIsSafe) {
        throw new Error(
          `Chain ${chainId}: proxy owner (${state.owner}) is not Safe (${safeAddress}); cannot safely propose upgrade`,
        );
      }
      const proposal = await proposeBatch(chainId, [tx], { safeAddress });
      chainOp.safeTxHash = proposal.safeTxHash;
      chainOp.nonce = proposal.nonce;
      chainOp.proposedUpgrade = true;

      // Best-effort verification: never blocks rollout flow.
      chainOp.verification = verifyImplementation(chainId, implementationAddress);
    } else {
      chainOp.upgradeTxPreview = tx;
      chainOp.verification = {
        attempted: false,
        ok: false,
        reason: "dry-run",
      };
    }

    summary.operations.push(chainOp);
  }

  const outputPath = writeOutput("deposit-router-upgrade", summary);
  console.log("=== DepositRouter Upgrade Plan ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Output: ${outputPath}`);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to deploy/propose.");
  }
}

main().catch((error) => {
  console.error("depositRouterUpgradePropose failed:", error.message);
  process.exit(1);
});
