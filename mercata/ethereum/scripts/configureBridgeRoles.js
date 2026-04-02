/**
 * Configure roles, token mappings, and rate limits for the new bridge contracts.
 * Designed to be called via Safe multisig (proposes Safe transactions).
 *
 * Reads deployment info from deployments/ directory.
 * Dry-run by default. Use --apply to submit Safe proposals.
 *
 * Usage:
 *   node scripts/configureBridgeRoles.js --network sepolia
 *   node scripts/configureBridgeRoles.js --network sepolia --apply
 *   node scripts/configureBridgeRoles.js --network baseSepolia --apply
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config();
require("dotenv").config({ path: path.resolve(__dirname, "../../services/bridge/.env") });

const { ethers } = require("ethers");
const {
  CHAIN_CONFIG,
  normalizeAddress,
  getRpcUrl,
  proposeBatch,
  writeOutput,
} = require("./lib/depositRouterSafeOps");

// =============================================================================
// Configuration — edit these for your deployment
// =============================================================================

// STRATO-side token addresses (40-char hex, no 0x prefix) for native assets
const STRATO_NATIVE_TOKENS = {
  USDST: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  GOLDST: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
  SILVST: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
};

// Rate limit defaults (per 24-hour window)
const DEFAULT_RATE_LIMITS = {
  vault: {
    // address(0) = ETH; other tokens by symbol
    ETH:  { maxAmount: ethers.parseEther("100"),     windowDuration: 86400 },
    USDC: { maxAmount: ethers.parseUnits("500000", 6), windowDuration: 86400 },
    USDT: { maxAmount: ethers.parseUnits("500000", 6), windowDuration: 86400 },
  },
  repBridge: {
    mint: { maxAmount: ethers.parseEther("1000000"), windowDuration: 86400 },
    burn: { maxAmount: ethers.parseEther("1000000"), windowDuration: 86400 },
  },
};

// =============================================================================
// Helpers
// =============================================================================

const CHAIN_NAME_TO_ID = {
  sepolia: 11155111,
  baseSepolia: 84532,
  "base-sepolia": 84532,
  base_sepolia: 84532,
  mainnet: 1,
  ethereum: 1,
  base: 8453,
  base_mainnet: 8453,
  linea: 59144,
  lineaSepolia: 59141,
  "linea-sepolia": 59141,
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { apply: false, network: "sepolia" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--network" && argv[i + 1]) {
      args.network = argv[++i];
    }
  }
  return args;
}

function loadDeployment(contractName, networkName) {
  const filepath = path.resolve(
    __dirname,
    `../deployments/${contractName}_${networkName}_latest.json`,
  );
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function loadAllRepTokens(networkName) {
  const tokens = {};
  for (const symbol of Object.keys(STRATO_NATIVE_TOKENS)) {
    const deployment = loadDeployment(`StratoRepresentationToken_${symbol}`, networkName);
    if (deployment) {
      tokens[symbol] = deployment.addresses.proxy;
    }
  }
  return tokens;
}

// =============================================================================
// ABI Fragments for encoding
// =============================================================================

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account)",
];
const VAULT_ABI = [
  "function setRateLimit(address token, uint256 maxAmount, uint256 windowDuration)",
];
const REP_BRIDGE_ABI = [
  "function setTokenMapping(address stratoToken, address representationToken)",
  "function setMintRateLimit(address stratoToken, uint256 maxAmount, uint256 windowDuration)",
  "function setBurnRateLimit(address stratoToken, uint256 maxAmount, uint256 windowDuration)",
];
const DEPOSIT_ROUTER_ABI = [
  "function setGnosisSafe(address newSafe)",
];

const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR"));
const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER"));

// =============================================================================
// Transaction Builders
// =============================================================================

function buildTx(to, abi, method, args) {
  const iface = new ethers.Interface(abi);
  return {
    to: ethers.getAddress(to),
    value: "0",
    data: iface.encodeFunctionData(method, args),
    operation: 0,
    meta: { method, args: args.map(String) },
  };
}

async function main() {
  const args = parseArgs();
  const networkName = args.network;
  const chainId = CHAIN_NAME_TO_ID[networkName];
  if (!chainId) {
    console.error(`Unknown network: ${networkName}`);
    process.exit(1);
  }

  const operatorAddress = process.env.ACROSS_SIGNER_PRIVATE_KEY
    ? new ethers.Wallet(
        process.env.ACROSS_SIGNER_PRIVATE_KEY.startsWith("0x")
          ? process.env.ACROSS_SIGNER_PRIVATE_KEY
          : `0x${process.env.ACROSS_SIGNER_PRIVATE_KEY}`,
      ).address
    : null;

  const safeAddress = process.env.SAFE_ADDRESS;

  // Load deployments
  const vaultDeployment = loadDeployment("ExternalBridgeVault", networkName);
  const repBridgeDeployment = loadDeployment("StratoRepresentationBridge", networkName);
  const repTokens = loadAllRepTokens(networkName);

  console.log("=== Bridge Role & Config Plan ===");
  console.log(`Network: ${networkName} (${chainId})`);
  console.log(`Safe: ${safeAddress}`);
  console.log(`Operator: ${operatorAddress}`);
  console.log(`Vault: ${vaultDeployment?.addresses?.proxy || "NOT DEPLOYED"}`);
  console.log(`RepBridge: ${repBridgeDeployment?.addresses?.proxy || "NOT DEPLOYED"}`);
  console.log(`RepTokens: ${JSON.stringify(repTokens, null, 2)}`);
  console.log(`Apply: ${args.apply}`);

  const transactions = [];

  // --- 1. Grant BRIDGE_OPERATOR on ExternalBridgeVault ---
  if (vaultDeployment && operatorAddress) {
    transactions.push(
      buildTx(vaultDeployment.addresses.proxy, ACCESS_CONTROL_ABI, "grantRole", [
        BRIDGE_OPERATOR_ROLE,
        operatorAddress,
      ]),
    );
  }

  // --- 2. Grant BRIDGE_OPERATOR on StratoRepresentationBridge ---
  if (repBridgeDeployment && operatorAddress) {
    transactions.push(
      buildTx(repBridgeDeployment.addresses.proxy, ACCESS_CONTROL_ABI, "grantRole", [
        BRIDGE_OPERATOR_ROLE,
        operatorAddress,
      ]),
    );
  }

  // --- 3. Grant MINTER_ROLE on each StratoRepresentationToken to the bridge ---
  if (repBridgeDeployment) {
    for (const [symbol, tokenAddr] of Object.entries(repTokens)) {
      transactions.push(
        buildTx(tokenAddr, ACCESS_CONTROL_ABI, "grantRole", [
          MINTER_ROLE,
          repBridgeDeployment.addresses.proxy,
        ]),
      );
    }
  }

  // --- 4. Register token mappings on StratoRepresentationBridge ---
  if (repBridgeDeployment) {
    for (const [symbol, tokenAddr] of Object.entries(repTokens)) {
      const stratoAddr = STRATO_NATIVE_TOKENS[symbol];
      if (!stratoAddr) continue;
      // Map STRATO address (as 0x-prefixed 20-byte) to representation token
      transactions.push(
        buildTx(repBridgeDeployment.addresses.proxy, REP_BRIDGE_ABI, "setTokenMapping", [
          ethers.getAddress(`0x${stratoAddr}`),
          tokenAddr,
        ]),
      );
    }
  }

  // --- 5. Set rate limits on StratoRepresentationBridge ---
  if (repBridgeDeployment) {
    for (const [symbol, tokenAddr] of Object.entries(repTokens)) {
      const stratoAddr = STRATO_NATIVE_TOKENS[symbol];
      if (!stratoAddr) continue;
      const fullAddr = ethers.getAddress(`0x${stratoAddr}`);
      transactions.push(
        buildTx(repBridgeDeployment.addresses.proxy, REP_BRIDGE_ABI, "setMintRateLimit", [
          fullAddr,
          DEFAULT_RATE_LIMITS.repBridge.mint.maxAmount,
          DEFAULT_RATE_LIMITS.repBridge.mint.windowDuration,
        ]),
      );
      transactions.push(
        buildTx(repBridgeDeployment.addresses.proxy, REP_BRIDGE_ABI, "setBurnRateLimit", [
          fullAddr,
          DEFAULT_RATE_LIMITS.repBridge.burn.maxAmount,
          DEFAULT_RATE_LIMITS.repBridge.burn.windowDuration,
        ]),
      );
    }
  }

  // --- 6. Repoint DepositRouter custody to the vault ---
  const depositRouterAddress = process.env[`CHAIN_${chainId}_DEPOSIT_ROUTER`];
  if (vaultDeployment && depositRouterAddress) {
    transactions.push(
      buildTx(depositRouterAddress, DEPOSIT_ROUTER_ABI, "setGnosisSafe", [
        vaultDeployment.addresses.proxy,
      ]),
    );
  }

  // --- Summary ---
  console.log(`\nPlanned transactions: ${transactions.length}`);
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    console.log(`  [${i}] ${tx.meta.method} -> ${tx.to}`);
  }

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to submit Safe proposals.");
    const outputPath = writeOutput(`bridge-config-${networkName}`, {
      network: networkName,
      chainId,
      transactionCount: transactions.length,
      transactions: transactions.map((t) => ({ to: t.to, ...t.meta })),
    });
    console.log(`Output: ${outputPath}`);
    return;
  }

  // Submit as Safe proposal
  if (!safeAddress) {
    console.error("SAFE_ADDRESS required for --apply");
    process.exit(1);
  }

  console.log("\nSubmitting Safe proposals...");
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    console.log(`  [${i}] ${tx.meta.method}...`);
    const result = await proposeBatch(chainId, [
      { to: tx.to, value: tx.value, data: tx.data, operation: tx.operation },
    ], { safeAddress });
    console.log(`    safeTxHash: ${result.safeTxHash} nonce: ${result.nonce}`);
  }

  console.log("\nAll proposals submitted. Approve them in the Safe UI.");
}

main().catch((error) => {
  console.error("Configuration failed:", error.message);
  process.exit(1);
});
