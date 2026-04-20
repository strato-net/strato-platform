/**
 * Grant BRIDGE_OPERATOR_ROLE on the ExternalBridgeVault and/or the
 * StratoRepresentationBridge to the main Safe (and optionally the hot wallet)
 * via Safe proposal.
 *
 * The Safe itself holds DEFAULT_ADMIN_ROLE on both contracts, so it proposes
 * the grantRole call and approves it through the normal multisig flow.
 *
 * Safely idempotent — checks hasRole() first and only proposes grants for
 * accounts that don't already have the role.
 *
 * Dry-run by default. Use --apply to submit Safe proposals.
 *
 * Usage:
 *   node scripts/grantBridgeOperatorRole.js --network sepolia
 *   node scripts/grantBridgeOperatorRole.js --network baseSepolia --apply
 *
 *   # Target a specific contract only
 *   node scripts/grantBridgeOperatorRole.js --network sepolia --contract vault
 *   node scripts/grantBridgeOperatorRole.js --network sepolia --contract repBridge
 *
 *   # Include hot wallet grants as well as main Safe
 *   node scripts/grantBridgeOperatorRole.js --network sepolia --apply --include-hot-wallet
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
  const args = {
    apply: false,
    network: null,
    includeHotWallet: false,
    contract: "both",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--include-hot-wallet") args.includeHotWallet = true;
    if (argv[i] === "--network" && argv[i + 1]) args.network = argv[++i];
    if (argv[i] === "--contract" && argv[i + 1]) args.contract = argv[++i];
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

async function collectGrantsForContract(label, proxyAddress, provider, accountsToCheck) {
  const contract = new ethers.Contract(proxyAddress, ACCESS_CONTROL_ABI, provider);
  const transactions = [];

  console.log(`\n[${label}] ${proxyAddress}`);
  for (const { name, address } of accountsToCheck) {
    try {
      const hasRole = await contract.hasRole(BRIDGE_OPERATOR_ROLE, address);
      if (hasRole) {
        console.log(`  ✓ ${name} already has BRIDGE_OPERATOR_ROLE`);
      } else {
        console.log(`  ✗ ${name} missing BRIDGE_OPERATOR_ROLE — will grant`);
        transactions.push(
          buildTx(proxyAddress, "grantRole", [BRIDGE_OPERATOR_ROLE, address]),
        );
      }
    } catch (e) {
      console.log(`  ⚠ ${name}: read failed (${e.shortMessage || e.message})`);
    }
  }

  return transactions;
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

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const accountsToCheck = [{ name: "Safe", address: safeAddress }];
  if (hotWalletAddress) {
    accountsToCheck.push({ name: "HotWallet", address: hotWalletAddress });
  }

  console.log("=".repeat(60));
  console.log("GRANT BRIDGE_OPERATOR_ROLE");
  console.log("=".repeat(60));
  console.log(`Network:       ${args.network} (${chainId})`);
  console.log(`Safe:          ${safeAddress}`);
  if (hotWalletAddress) {
    console.log(`Hot Wallet:    ${hotWalletAddress}`);
  }
  console.log(`Contract:      ${args.contract}`);
  console.log(`Apply:         ${args.apply}`);

  const allTransactions = [];

  // ExternalBridgeVault
  if (args.contract === "both" || args.contract === "vault") {
    const vaultDeployment = loadDeployment("ExternalBridgeVault", args.network);
    if (!vaultDeployment) {
      console.log(`\n[ExternalBridgeVault] No deployment file — skipping`);
    } else {
      const txs = await collectGrantsForContract(
        "ExternalBridgeVault",
        vaultDeployment.addresses.proxy,
        provider,
        accountsToCheck,
      );
      allTransactions.push(...txs);
    }
  }

  // StratoRepresentationBridge
  if (args.contract === "both" || args.contract === "repBridge") {
    const repBridgeDeployment = loadDeployment("StratoRepresentationBridge", args.network);
    if (!repBridgeDeployment) {
      console.log(`\n[StratoRepresentationBridge] No deployment file — skipping`);
    } else {
      const txs = await collectGrantsForContract(
        "StratoRepresentationBridge",
        repBridgeDeployment.addresses.proxy,
        provider,
        accountsToCheck,
      );
      allTransactions.push(...txs);
    }
  }

  if (allTransactions.length === 0) {
    console.log("\nNothing to do — all requested accounts already have the role.");
    return;
  }

  console.log(`\nPlanned transactions: ${allTransactions.length}`);
  allTransactions.forEach((tx, i) => {
    console.log(`  [${i}] ${tx.to} → grantRole(BRIDGE_OPERATOR, ${tx.meta.args[1]})`);
  });

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to submit Safe proposals.");
    const outputPath = writeOutput(`grant-bridge-operator-${args.network}`, {
      network: args.network,
      chainId,
      transactionCount: allTransactions.length,
      transactions: allTransactions.map((t) => ({ to: t.to, ...t.meta })),
    });
    console.log(`Output: ${outputPath}`);
    return;
  }

  console.log("\nSubmitting Safe proposals...");
  for (let i = 0; i < allTransactions.length; i++) {
    const tx = allTransactions[i];
    console.log(`  [${i}] grantRole on ${tx.to} → ${tx.meta.args[1]}`);
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
  console.error("\ngrantBridgeOperatorRole failed:", error.message);
  process.exit(1);
});
