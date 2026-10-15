const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { getChainConfig, getRpcUrl, normalizeAddress } = require("./depositRouterSafeOps");

const SAFE_EXECUTION_EVENTS = new ethers.Interface([
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)",
  "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
]);

function loadProtocolKit() {
  try {
    const protocol = require("@safe-global/protocol-kit");
    return protocol.default || protocol;
  } catch {
    throw new Error("Safe dependencies not found. Run `cd app/ethereum && npm ci` first.");
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadBridgeInterfaces() {
  const root = path.resolve(__dirname, "../../artifacts/contracts/bridge");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true })
    .filter(file => String(file).endsWith(".json") && !String(file).endsWith(".dbg.json"))
    .flatMap((file) => {
      try {
        const artifact = readJson(path.join(root, file));
        return Array.isArray(artifact.abi) ? [new ethers.Interface(artifact.abi)] : [];
      } catch {
        return [];
      }
    });
}

function printable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(printable);
  return value;
}

function decodeCall(data, interfaces = loadBridgeInterfaces()) {
  if (!data || data === "0x") return { method: "receive()", args: {} };
  const decoded = new Map();
  interfaces.forEach((iface) => {
    try {
      const parsed = iface.parseTransaction({ data });
      const method = parsed.fragment.format("sighash");
      if (!decoded.has(method)) {
        decoded.set(method, Object.fromEntries(parsed.fragment.inputs.map((input, index) => [
          input.name || String(index),
          printable(parsed.args[index]),
        ])));
      }
    } catch {
      // The selector does not belong to this artifact.
    }
  });
  if (decoded.size === 1) {
    const [[method, args]] = decoded;
    return { method, args };
  }
  if (decoded.size > 1) return { candidates: [...decoded.keys()] };
  return { method: "unknown", args: {}, selector: data.slice(0, 10) };
}

function validateBatch(batch, expected = {}) {
  if (!batch || batch.version !== "1.0" || !Array.isArray(batch.transactions) ||
      batch.transactions.length === 0) {
    throw new Error("Invalid or empty Safe Transaction Builder file");
  }
  const chainId = Number(batch.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid Safe batch chainId");
  getChainConfig(chainId);
  if (expected.chainId !== undefined && chainId !== Number(expected.chainId)) {
    throw new Error(`Safe batch chainId ${chainId} does not match expected chainId ${expected.chainId}`);
  }
  const safeAddress = normalizeAddress(batch.meta?.createdFromSafeAddress);
  if (!safeAddress) throw new Error("Invalid Safe batch address");
  if (expected.safeAddress && safeAddress !== normalizeAddress(expected.safeAddress)) {
    throw new Error(`Safe batch address ${safeAddress} does not match expected Safe ${expected.safeAddress}`);
  }
  const transactions = batch.transactions.map((transaction, index) => {
    const to = normalizeAddress(transaction.to);
    if (!to) throw new Error(`Invalid target in Safe transaction ${index + 1}`);
    const value = String(transaction.value ?? "0");
    if (!/^\d+$/.test(value)) throw new Error(`Invalid value in Safe transaction ${index + 1}`);
    const data = transaction.data || "0x";
    if (!ethers.isHexString(data)) throw new Error(`Invalid calldata in Safe transaction ${index + 1}`);
    return { to, value, data, operation: 0 };
  });
  return { chainId, safeAddress, transactions };
}

async function buildSafeTransaction(batch, options = {}) {
  const validated = validateBatch(batch, options);
  const rpcUrl = options.rpcUrl || getRpcUrl(validated.chainId);
  const provider = options.provider || new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== validated.chainId) {
    throw new Error(`RPC chainId ${network.chainId} does not match Safe batch chainId ${validated.chainId}`);
  }
  const SafeProtocolKit = options.SafeProtocolKit || loadProtocolKit();
  const protocolKit = options.protocolKit || await SafeProtocolKit.init({
    provider: rpcUrl,
    signer: options.signer,
    safeAddress: validated.safeAddress,
  });
  const [owners, threshold, currentNonce] = await Promise.all([
    protocolKit.getOwners(),
    protocolKit.getThreshold(),
    protocolKit.getNonce(),
  ]);
  const nonce = options.nonce === undefined ? currentNonce : Number(options.nonce);
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error("Invalid Safe nonce");
  const safeTransaction = await protocolKit.createTransaction({
    transactions: validated.transactions,
    options: { nonce },
  });
  const safeTxHash = await protocolKit.getTransactionHash(safeTransaction);
  return {
    ...validated,
    provider,
    protocolKit,
    owners: owners.map(normalizeAddress),
    threshold: Number(threshold),
    currentNonce: Number(currentNonce),
    nonce,
    executorAddress: options.executorAddress,
    safeTransaction,
    safeTxHash,
  };
}

function signatureRecord(context, signature) {
  const signer = normalizeAddress(signature.signer);
  if (!signer || !context.owners.includes(signer)) throw new Error("Safe signature was not produced by an owner");
  return {
    format: "eab-safe-signature",
    chainId: String(context.chainId),
    safeAddress: context.safeAddress,
    nonce: context.nonce,
    safeTxHash: context.safeTxHash,
    signer,
    signature: signature.data,
  };
}

function validateSignature(record, context) {
  const signer = normalizeAddress(record?.signer);
  if (record?.format !== "eab-safe-signature" ||
      String(record.chainId) !== String(context.chainId) ||
      normalizeAddress(record.safeAddress) !== context.safeAddress ||
      Number(record.nonce) !== context.nonce ||
      String(record.safeTxHash).toLowerCase() !== context.safeTxHash.toLowerCase() ||
      !signer || !context.owners.includes(signer) ||
      !ethers.isHexString(record.signature, 65)) {
    throw new Error("Signature file does not match this Safe transaction");
  }
  return { ...record, signer };
}

function addSignatures(context, records) {
  const { EthSafeSignature } = require("@safe-global/protocol-kit");
  const unique = new Map();
  records.forEach((record) => {
    const validated = validateSignature(record, context);
    if (unique.has(validated.signer)) throw new Error(`Duplicate Safe signature from ${validated.signer}`);
    unique.set(validated.signer, validated);
    context.safeTransaction.addSignature(new EthSafeSignature(validated.signer, validated.signature));
  });
  if (unique.size < context.threshold) {
    throw new Error(`Safe requires ${context.threshold} owner signatures; received ${unique.size}`);
  }
  return [...unique.values()];
}

async function requireExecutorGas(context) {
  const executorAddress = normalizeAddress(context.executorAddress);
  if (!executorAddress) throw new Error("Missing Safe transaction executor address");
  const [balance, encoded, feeData] = await Promise.all([
    context.provider.getBalance(executorAddress),
    context.protocolKit.getEncodedTransaction(context.safeTransaction),
    context.provider.getFeeData(),
  ]);
  const estimatedGas = await context.provider.estimateGas({
    from: executorAddress,
    to: context.safeAddress,
    data: encoded,
  });
  const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
  if (!gasPrice) throw new Error("RPC did not return a gas price for Safe execution");
  const required = estimatedGas * gasPrice * 12n / 10n;
  if (balance < required) {
    throw new Error(`Safe executor ${executorAddress} has insufficient gas balance: ${balance} < ${required}`);
  }
  return {
    executorAddress,
    balance: balance.toString(),
    estimatedGas: estimatedGas.toString(),
    gasPrice: gasPrice.toString(),
    required: required.toString(),
  };
}

function requireExecutionSuccess(receipt, safeAddress, safeTxHash) {
  let outcome;
  for (const log of receipt.logs || []) {
    if (normalizeAddress(log.address) !== safeAddress) continue;
    try {
      const event = SAFE_EXECUTION_EVENTS.parseLog(log);
      if (String(event.args.txHash).toLowerCase() !== safeTxHash.toLowerCase()) continue;
      outcome = event.name;
    } catch {
      // Not a Safe execution event.
    }
  }
  if (outcome === "ExecutionFailure") throw new Error(`Safe reported ExecutionFailure for ${safeTxHash}`);
  if (outcome !== "ExecutionSuccess") throw new Error(`Safe ExecutionSuccess was not found for ${safeTxHash}`);
}

async function executeSignedBatch(context, records, confirmedHash) {
  if (String(confirmedHash).toLowerCase() !== context.safeTxHash.toLowerCase()) {
    throw new Error("Confirmed Safe transaction hash does not match the reviewed batch");
  }
  if (context.currentNonce !== context.nonce) {
    throw new Error(`Safe nonce is now ${context.currentNonce}, but signatures bind nonce ${context.nonce}; reconcile live state before retrying`);
  }
  addSignatures(context, records);
  if (!await context.protocolKit.isValidTransaction(context.safeTransaction)) {
    throw new Error("Safe transaction simulation failed");
  }
  const gas = await requireExecutorGas(context);
  const submitted = await context.protocolKit.executeTransaction(context.safeTransaction);
  const receipt = await context.provider.waitForTransaction(submitted.hash);
  if (!receipt || receipt.status !== 1) throw new Error(`Safe execution failed: ${submitted.hash}`);
  requireExecutionSuccess(receipt, context.safeAddress, context.safeTxHash);
  const finalNonce = Number(await context.protocolKit.getNonce());
  if (finalNonce !== context.nonce + 1) {
    throw new Error(`Safe execution receipt succeeded but nonce is ${finalNonce}; expected ${context.nonce + 1}`);
  }
  return { transactionHash: submitted.hash, safeTxHash: context.safeTxHash, nonce: context.nonce, gas };
}

module.exports = {
  readJson,
  loadBridgeInterfaces,
  decodeCall,
  validateBatch,
  buildSafeTransaction,
  signatureRecord,
  validateSignature,
  addSignatures,
  requireExecutorGas,
  requireExecutionSuccess,
  executeSignedBatch,
};
