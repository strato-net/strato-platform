const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { NETWORKS } = require("./externalBridgeNetworks");

const safeProtocolKitPath = path.resolve(
  __dirname,
  "../../../services/bridge/node_modules/@safe-global/protocol-kit",
);
const safeApiKitPath = path.resolve(
  __dirname,
  "../../../services/bridge/node_modules/@safe-global/api-kit",
);

function loadSafeDependencies() {
  if (!fs.existsSync(safeProtocolKitPath) || !fs.existsSync(safeApiKitPath)) {
    throw new Error(
      "Safe dependencies not found. Run `cd app/services/bridge && npm install && npm run build` from the repo root first.",
    );
  }
  const protocol = require(safeProtocolKitPath);
  const api = require(safeApiKitPath);
  return { SafeProtocolKit: protocol.default || protocol, SafeApiKit: api.default || api };
}

const CHAIN_CONFIG = Object.fromEntries(NETWORKS.map((network) => [network.chainId, network]));

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
  const pk = normalizePrivateKey(process.env.SAFE_PROPOSER_PRIVATE_KEY);
  if (!pk) {
    throw new Error("Missing SAFE_PROPOSER_PRIVATE_KEY for Safe proposal");
  }
  return pk;
}

function getSafeApiKey() {
  return process.env.SAFE_API_KEY || "";
}

function getSafeProposerAddress() {
  const configured = process.env.SAFE_PROPOSER_ADDRESS;
  if (configured) {
    const normalized = normalizeAddress(configured);
    if (!normalized) {
      throw new Error("Invalid SAFE_PROPOSER_ADDRESS");
    }
    return normalized;
  }
  return new ethers.Wallet(getSafeSignerPrivateKey()).address;
}

function encodeCall(method, args) {
  const artifact = loadDepositRouterArtifact();
  const iface = new ethers.Interface(artifact.abi);
  return iface.encodeFunctionData(method, args);
}

function resolveSafeTxGasOverride(parsedOptions) {
  const raw =
    parsedOptions?.safeTxGas ??
    parsedOptions?.safeTxGasLimit ??
    process.env.SAFE_TX_GAS;

  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return undefined;
  }

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  throw new Error(`Invalid safeTxGas override: ${String(raw)}`);
}

async function proposeBatch(chainId, transactions, options) {
  const { SafeProtocolKit, SafeApiKit } = loadSafeDependencies();
  const parsedOptions =
    options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
  const safeAddress = normalizeAddress(parsedOptions.safeAddress);
  const nonceValue = parsedOptions.nonce;
  const safeTxGas = resolveSafeTxGasOverride(parsedOptions);

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

  const txOptions = { nonce };
  if (safeTxGas !== undefined) {
    txOptions.safeTxGas = String(safeTxGas);
  }

  const safeTx = await protocolKit.createTransaction({
    transactions,
    options: txOptions,
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

function buildTransactionBuilderBatch(
  chainId,
  safeAddress,
  transactions,
  { name, description = "" } = {},
) {
  const normalizedSafe = normalizeAddress(safeAddress);
  if (!normalizedSafe) throw new Error("Invalid Safe address");
  const normalizedTransactions = transactions.map((transaction) => {
    if (Number(transaction.operation || 0) !== 0) {
      throw new Error("Safe Transaction Builder export supports CALL operations only");
    }
    const to = normalizeAddress(transaction.to);
    if (!to) throw new Error("Invalid Safe transaction target");
    return {
      to,
      value: String(transaction.value || "0"),
      data: transaction.data || "0x",
      contractMethod: null,
      contractInputsValues: null,
    };
  });
  return {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name: name || "External Asset Bridge Safe operations",
      description,
      txBuilderVersion: "1.18.0",
      createdFromSafeAddress: normalizedSafe,
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: normalizedTransactions,
  };
}

function writeTransactionBuilderOutput(filePrefix, payload) {
  return writeOutput(`${filePrefix}-txbuilder`, payload);
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
  buildTransactionBuilderBatch,
  writeTransactionBuilderOutput,
};
