/**
 * Grant BRIDGE_OPERATOR_ROLE on the StratoRepresentationBridge to the main Safe
 * (and optionally the hot wallet Safe) via Safe proposal.
 *
 * The Safe itself holds DEFAULT_ADMIN_ROLE, so it proposes the grantRole call
 * and approves it through the normal multisig flow.
 *
 * Dry-run by default. Use --apply to submit Safe proposals.
 *
 * Usage:
 *   node scripts/grantRepBridgeOperatorRole.js --network sepolia
 *   node scripts/grantRepBridgeOperatorRole.js --network baseSepolia --apply
 *   node scripts/grantRepBridgeOperatorRole.js --network sepolia --apply       # grants only to main Safe
 *   node scripts/grantRepBridgeOperatorRole.js --network sepolia --apply --include-hot-wallet
 */
const path = require("path");
const fs = require("fs");
require("dotenv").config();
require("dotenv").config({
  path: path.resolve(__dirname, "../../services/bridge/.env"),
});

const { ethers } = require("ethers");
const {
  proposeBatch,
  writeOutput,
} = require("./lib/depositRouterSafeOps");

const CHAIN_NAME_TO_ID = {
  sepolia: 11155111,
  baseSepolia: 84532,
  "base-sepolia": 84532,
};

const BRIDGE_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_OPERATOR"));

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { apply: false, network: null, includeHotWallet: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--include-hot-wallet") args.includeHotWallet = true;
    if (argv[i] === "--network" && argv[i + 1]) args.network = argv[++i];
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

function buildTx(to, method, args) {
  const iface = new ethers.Interface(ACCESS_CONTROL_ABI);
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
  if (!args.network) {
    console.error("ERROR: --network is required (sepolia or baseSepolia)");
    process.exit(1);
  }

  const chainId = CHAIN_NAME_TO_ID[args.network];
  if (!chainId) {
    console.error(`Unknown network: ${args.network}`);
    process.exit(1);
  }

  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) {
    console.error("ERROR: SAFE_ADDRESS is required");
    process.exit(1);
  }

  const hotWalletAddress = args.includeHotWallet
    ? process.env.SAFE_HOT_WALLET_ADDRESS
    : null;
  if (args.includeHotWallet && !hotWalletAddress) {
    console.error("ERROR: --include-hot-wallet specified but SAFE_HOT_WALLET_ADDRESS not set");
    process.exit(1);
  }

  const rpcUrl = process.env[`CHAIN_${chainId}_RPC_URL`];
  if (!rpcUrl) {
    console.error(`ERROR: CHAIN_${chainId}_RPC_URL is required`);
    process.exit(1);
  }

  const repBridgeDeployment = loadDeployment("StratoRepresentationBridge", args.network);
  if (!repBridgeDeployment) {
    console.error(`ERROR: deployments/StratoRepresentationBridge_${args.network}_latest.json not found`);
    process.exit(1);
  }

  const repBridgeAddress = ethers.getAddress(repBridgeDeployment.addresses.proxy);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const repBridge = new ethers.Contract(repBridgeAddress, ACCESS_CONTROL_ABI, provider);

  console.log("=".repeat(60));
  console.log("GRANT BRIDGE_OPERATOR_ROLE on StratoRepresentationBridge");
  console.log("=".repeat(60));
  console.log(`Network:          ${args.network} (${chainId})`);
  console.log(`RepBridge:        ${repBridgeAddress}`);
  console.log(`Safe:             ${safeAddress}`);
  if (args.includeHotWallet) {
    console.log(`Hot Wallet:       ${hotWalletAddress}`);
  }
  console.log(`Apply:            ${args.apply}`);
  console.log();

  const transactions = [];

  // Main Safe
  const safeHasRole = await repBridge.hasRole(BRIDGE_OPERATOR_ROLE, safeAddress);
  if (safeHasRole) {
    console.log(`✓ Safe already has BRIDGE_OPERATOR_ROLE — skipping`);
  } else {
    console.log(`✗ Safe does NOT have BRIDGE_OPERATOR_ROLE — will grant`);
    transactions.push(
      buildTx(repBridgeAddress, "grantRole", [BRIDGE_OPERATOR_ROLE, safeAddress]),
    );
  }

  // Hot wallet (optional)
  if (args.includeHotWallet) {
    const hotHasRole = await repBridge.hasRole(BRIDGE_OPERATOR_ROLE, hotWalletAddress);
    if (hotHasRole) {
      console.log(`✓ HotWallet already has BRIDGE_OPERATOR_ROLE — skipping`);
    } else {
      console.log(`✗ HotWallet does NOT have BRIDGE_OPERATOR_ROLE — will grant`);
      transactions.push(
        buildTx(repBridgeAddress, "grantRole", [BRIDGE_OPERATOR_ROLE, hotWalletAddress]),
      );
    }
  }

  if (transactions.length === 0) {
    console.log("\nNothing to do — all requested accounts already have the role.");
    return;
  }

  console.log(`\nPlanned transactions: ${transactions.length}`);
  transactions.forEach((tx, i) => {
    console.log(`  [${i}] grantRole(BRIDGE_OPERATOR, ${tx.meta.args[1]})`);
  });

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to submit Safe proposals.");
    const outputPath = writeOutput(`grant-rep-bridge-operator-${args.network}`, {
      network: args.network,
      chainId,
      repBridge: repBridgeAddress,
      transactionCount: transactions.length,
      transactions: transactions.map((t) => ({ to: t.to, ...t.meta })),
    });
    console.log(`Output: ${outputPath}`);
    return;
  }

  console.log("\nSubmitting Safe proposals...");
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    console.log(`  [${i}] ${tx.meta.method}(${tx.meta.args.join(", ")})`);
    try {
      const result = await proposeBatch(
        chainId,
        [{ to: tx.to, value: tx.value, data: tx.data, operation: tx.operation }],
        { safeAddress },
      );
      console.log(`    safeTxHash: ${result.safeTxHash} nonce: ${result.nonce}`);
    } catch (error) {
      console.error(`    FAILED: ${error.message}`);
    }
  }

  console.log("\nDone. Approve the proposals in the Safe UI.");
  console.log(`\nAfter approval, verify with:`);
  console.log(`  node scripts/verifyBridgeConfig.js --network ${args.network}`);
}

main().catch((error) => {
  console.error("\ngrantRepBridgeOperatorRole failed:", error.message);
  process.exit(1);
});
