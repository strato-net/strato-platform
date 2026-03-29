/**
 * Vault → EVM transaction sender
 *
 * Uses the STRATO vault signing service to sign and submit
 * a transaction on any EVM chain. Same key, any network.
 *
 * Usage:
 *   node send-tx.js                    # dry-run (sign only, no submit)
 *   node send-tx.js --submit           # sign and submit
 *   node send-tx.js --to 0x... --value 0.001 --submit
 *
 * Env:
 *   NETWORK_RPC  - RPC endpoint (default: Sepolia public RPC)
 *   VAULT_URL    - vault service (default: https://vault.blockapps.net:8093)
 *
 * Requires: ~/.secrets/stratoToken (run `strato-auth` first)
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const VAULT_URL = process.env.VAULT_URL || "https://vault.blockapps.net:8093";
const DEFAULT_NETWORK_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const NETWORK_RPC = process.env.NETWORK_RPC || DEFAULT_NETWORK_RPC;

// ---------------------------------------------------------------------------
// Vault API helpers
// ---------------------------------------------------------------------------

function loadToken() {
  const tokenPath = path.join(
    process.env.HOME,
    ".secrets",
    "stratoToken"
  );
  const data = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (now >= data.expires_at) {
    throw new Error("Token expired. Run `strato-auth` to re-authenticate.");
  }
  return data.access_token;
}

function vaultRequest(method, endpoint, body) {
  const token = loadToken();
  const url = new URL(`${VAULT_URL}/strato/v2.3/${endpoint}`);
  const mod = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = mod.request(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(payload && { "Content-Type": "application/json" }),
        },
      },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) {
            reject(new Error(`Vault ${res.statusCode}: ${text}`));
          } else {
            resolve(JSON.parse(text));
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function vaultGetAddress() {
  const resp = await vaultRequest("GET", "key");
  return { address: ethers.getAddress("0x" + resp.address), pubkey: resp.pubkey };
}

async function vaultSign(hash) {
  const hashHex = hash.startsWith("0x") ? hash.slice(2) : hash;
  const resp = await vaultRequest("POST", "signature", { msgHash: hashHex });
  return { r: "0x" + resp.r, s: "0x" + resp.s, v: resp.v };
}

// ---------------------------------------------------------------------------
// Transaction construction + signing
// ---------------------------------------------------------------------------

function toBigIntOrUndefined(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return BigInt(trimmed);
  }
  throw new Error(`Unsupported bigint value: ${String(value)}`);
}

async function signTransaction(provider, fromAddress, txRequest) {
  const to = txRequest.to || fromAddress;
  const value =
    txRequest.value !== undefined
      ? toBigIntOrUndefined(txRequest.value)
      : ethers.parseEther(txRequest.valueEth || "0");
  const data = txRequest.data || "0x";
  const [nonce, feeData] = await Promise.all([
    provider.getTransactionCount(fromAddress, "latest"),
    provider.getFeeData(),
  ]);

  const { chainId } = await provider.getNetwork();

  const tx = {
    type: 2,
    chainId,
    nonce: txRequest.nonce ?? nonce,
    to,
    value,
    data,
    maxFeePerGas: toBigIntOrUndefined(txRequest.maxFeePerGas) ?? feeData.maxFeePerGas,
    maxPriorityFeePerGas:
      toBigIntOrUndefined(txRequest.maxPriorityFeePerGas) ?? feeData.maxPriorityFeePerGas,
    gasLimit: toBigIntOrUndefined(txRequest.gasLimit) ?? 21000n,
  };

  console.log("\n--- Unsigned Transaction ---");
  console.log("  from:                ", fromAddress);
  console.log("  to:                  ", tx.to);
  console.log("  value:               ", ethers.formatEther(tx.value), "ETH");
  console.log("  nonce:               ", tx.nonce);
  console.log("  maxFeePerGas:        ", ethers.formatUnits(tx.maxFeePerGas, "gwei"), "gwei");
  console.log("  maxPriorityFeePerGas:", ethers.formatUnits(tx.maxPriorityFeePerGas, "gwei"), "gwei");
  console.log("  gasLimit:            ", tx.gasLimit.toString());
  console.log("  chainId:             ", tx.chainId);
  console.log("  data bytes:          ", (tx.data.length - 2) / 2);

  // Serialize the unsigned tx to get the signing hash
  const unsignedSerialized = ethers.Transaction.from(tx).unsignedSerialized;
  const signingHash = ethers.keccak256(unsignedSerialized);

  console.log("\n--- Signing via Vault ---");
  console.log("  signing hash:", signingHash);

  const sig = await vaultSign(signingHash);
  console.log("  vault response: r =", sig.r.slice(0, 18) + "...");
  console.log("                  s =", sig.s.slice(0, 18) + "...");
  console.log("                  v =", sig.v);

  // Assemble the signed transaction
  // ethers v6: vault v (0/1) maps to yParity for EIP-1559
  const signedTx = ethers.Transaction.from({
    ...tx,
    signature: ethers.Signature.from({
      r: sig.r,
      s: sig.s,
      v: 27 + sig.v, // ethers expects 27/28
    }),
  });

  // Verify the recovered address matches
  const recovered = signedTx.from;
  if (recovered.toLowerCase() !== fromAddress.toLowerCase()) {
    throw new Error(
      `Signature recovery mismatch!\n  expected: ${fromAddress}\n  recovered: ${recovered}`
    );
  }
  console.log("  recovered from:  ", recovered, "✓");

  return signedTx;
}

async function buildAndSign(provider, fromAddress, opts) {
  return signTransaction(provider, fromAddress, {
    to: opts.to,
    valueEth: opts.value || "0",
    gasLimit: 21000n,
  });
}

async function submitSignedTransaction(provider, signedTx) {
  const resp = await provider.broadcastTransaction(signedTx.serialized);
  return { response: resp, receipt: await resp.wait() };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const submit = args.includes("--submit");
  const toIdx = args.indexOf("--to");
  const valIdx = args.indexOf("--value");
  const to = toIdx >= 0 ? args[toIdx + 1] : undefined;
  const value = valIdx >= 0 ? args[valIdx + 1] : "0";

  console.log("Vault → EVM Transaction Sender");
  console.log("===============================\n");

  // 1. Get address from vault
  console.log("Fetching address from vault...");
  const { address } = await vaultGetAddress();
  console.log("  vault address:", address);

  // 2. Connect to network
  const provider = new ethers.JsonRpcProvider(NETWORK_RPC);
  const { chainId, name: networkName } = await provider.getNetwork();
  console.log("  network:       ", networkName, `(chainId ${chainId})`);
  const balance = await provider.getBalance(address);
  console.log("  balance:       ", ethers.formatEther(balance), "ETH");

  if (balance === 0n && submit) {
    console.error("\n  ⚠ Balance is 0. Fund this address first.");
    console.error("    Address:", address);
    process.exit(1);
  }

  // 3. Build and sign
  const signedTx = await buildAndSign(provider, address, { to, value });

  console.log("\n--- Signed Transaction ---");
  console.log("  hash:", signedTx.hash);
  console.log("  raw: ", signedTx.serialized.slice(0, 40) + "...");

  // 4. Submit (or dry-run)
  if (submit) {
    console.log("\n--- Submitting ---");
    const { response: resp, receipt } = await submitSignedTransaction(provider, signedTx);
    console.log("  tx hash:", resp.hash);
    console.log("\n  Waiting for confirmation...");
    console.log("  confirmed in block:", receipt.blockNumber);
    console.log("  gas used:", receipt.gasUsed.toString());
    console.log("  status:", receipt.status === 1 ? "SUCCESS ✓" : "FAILED ✗");
  } else {
    console.log("\n  Dry-run mode. Use --submit to broadcast.");
    console.log("  Full signed tx hex:");
    console.log(" ", signedTx.serialized);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("\nError:", err.message);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_NETWORK_RPC,
  loadToken,
  vaultRequest,
  vaultGetAddress,
  vaultSign,
  signTransaction,
  buildAndSign,
  submitSignedTransaction,
};
