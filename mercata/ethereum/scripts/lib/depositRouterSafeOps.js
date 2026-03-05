const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const bridgeConfigPath = path.resolve(
  __dirname,
  "../../../services/bridge/dist/config/index.js",
);
const safeProtocolKitPath = path.resolve(
  __dirname,
  "../../../services/bridge/node_modules/@safe-global/protocol-kit",
);
const safeApiKitPath = path.resolve(
  __dirname,
  "../../../services/bridge/node_modules/@safe-global/api-kit",
);

if (
  !fs.existsSync(bridgeConfigPath) ||
  !fs.existsSync(safeProtocolKitPath) ||
  !fs.existsSync(safeApiKitPath)
) {
  throw new Error(
    "Safe dependencies not found. Run `cd /Users/ariya/Documents/BlockApps/strato-platform/mercata/services/bridge && npm install && npm run build` first.",
  );
}

const { config: bridgeConfig } = require(bridgeConfigPath);
const SafeProtocolKitModule = require(safeProtocolKitPath);
const SafeApiKitModule = require(safeApiKitPath);
const SafeProtocolKit = SafeProtocolKitModule.default || SafeProtocolKitModule;
const SafeApiKit = SafeApiKitModule.default || SafeApiKitModule;

const CHAIN_CONFIG = {
  1: {
    chainId: 1,
    name: "mainnet",
    rpcEnv: "MAINNET_RPC_URL",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
  },
  8453: {
    chainId: 8453,
    name: "base",
    rpcEnv: "BASE_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org",
  },
  11155111: {
    chainId: 11155111,
    name: "sepolia",
    rpcEnv: "SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  84532: {
    chainId: 84532,
    name: "baseSepolia",
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    defaultRpcUrl: "https://sepolia.base.org",
  },
};

function normalizeAddress(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const withPrefix = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(withPrefix)) return "";
  try {
    return ethers.getAddress(withPrefix);
  } catch {
    return "";
  }
}

function normalizePrivateKey(value) {
  if (!value) return "";
  return String(value).startsWith("0x") ? String(value) : `0x${value}`;
}

function getChainConfig(chainId) {
  const cfg = CHAIN_CONFIG[Number(chainId)];
  if (!cfg) throw new Error(`Unsupported chainId: ${chainId}`);
  return cfg;
}

function getRpcUrl(chainId) {
  const cfg = getChainConfig(chainId);
  return process.env[cfg.rpcEnv] || cfg.defaultRpcUrl;
}

function loadDepositRouterArtifact() {
  const artifactPath = path.resolve(
    __dirname,
    "../../artifacts/contracts/bridge/DepositRouter.sol/DepositRouter.json",
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`DepositRouter artifact missing: ${artifactPath}`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

function getSafeSignerPrivateKey() {
  const pk = normalizePrivateKey(
    process.env.SAFE_PROPOSER_PRIVATE_KEY ||
      bridgeConfig?.safe?.safeProposerPrivateKey,
  );
  if (!pk) {
    throw new Error("Missing SAFE_PROPOSER_PRIVATE_KEY for Safe proposal");
  }
  return pk;
}

function getSafeApiKey() {
  return process.env.SAFE_API_KEY || bridgeConfig?.safe?.apiKey || "";
}

function getSafeProposerAddress() {
  const configured =
    process.env.SAFE_PROPOSER_ADDRESS || bridgeConfig?.safe?.safeProposerAddress;
  if (configured) {
    const normalized = normalizeAddress(configured);
    if (!normalized) {
      throw new Error("Invalid SAFE_PROPOSER_ADDRESS");
    }
    return normalized;
  }
  const bridgePk = bridgeConfig?.safe?.safeProposerPrivateKey;
  if (bridgePk) {
    return new ethers.Wallet(normalizePrivateKey(bridgePk)).address;
  }
  return new ethers.Wallet(getSafeSignerPrivateKey()).address;
}

function encodeCall(method, args) {
  const artifact = loadDepositRouterArtifact();
  const iface = new ethers.Interface(artifact.abi);
  return iface.encodeFunctionData(method, args);
}

function resolveSafeTxGas(parsedOptions, txCount) {
  const raw =
    parsedOptions?.safeTxGas ??
    parsedOptions?.safeTxGasLimit ??
    process.env.SAFE_TX_GAS;

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  const count = Number.isInteger(txCount) && txCount > 0 ? txCount : 1;
  return Math.max(120000, count * 120000);
}

async function proposeBatch(chainId, transactions, options) {
  const parsedOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const safeAddress = normalizeAddress(parsedOptions.safeAddress);
  const nonceValue = parsedOptions.nonce;
  const safeTxGas = resolveSafeTxGas(parsedOptions, transactions?.length || 1);

  if (!safeAddress) {
    throw new Error("Missing safeAddress for Safe proposal");
  }

  const protocolKit = await SafeProtocolKit.init({
    provider: getRpcUrl(Number(chainId)),
    signer: getSafeSignerPrivateKey(),
    safeAddress,
  });
  const apiKit = new SafeApiKit({
    chainId: BigInt(Number(chainId)),
    apiKey: getSafeApiKey(),
  });

  const proposerAddress = getSafeProposerAddress();
  const nonce = Number.isInteger(nonceValue)
    ? nonceValue
    : Number(await apiKit.getNextNonce(safeAddress));

  const safeTx = await protocolKit.createTransaction({
    transactions,
    options: {
      nonce,
      safeTxGas: String(safeTxGas),
    },
  });
  const safeTxHash = await protocolKit.getTransactionHash(safeTx);
  const signature = await protocolKit.signHash(safeTxHash);

  await apiKit.proposeTransaction({
    safeAddress,
    safeTransactionData: safeTx.data,
    safeTxHash,
    senderAddress: proposerAddress,
    senderSignature: signature.data,
  });

  return { safeTxHash, nonce, safeAddress, proposerAddress };
}

function chunkArray(values, size) {
  if (size <= 0) return [values];
  const chunks = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

function writeOutput(filePrefix, payload) {
  const outDir = path.resolve(__dirname, "../output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `${filePrefix}-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return outPath;
}

module.exports = {
  CHAIN_CONFIG,
  normalizeAddress,
  getChainConfig,
  getRpcUrl,
  loadDepositRouterArtifact,
  encodeCall,
  proposeBatch,
  chunkArray,
  writeOutput,
};
