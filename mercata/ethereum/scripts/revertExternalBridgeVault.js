/**
 * Revert the ExternalBridgeVault proxy back to its original ExternalBridgeVault
 * implementation (e.g., to undo a previous upgrade to StratoBridge).
 *
 * Since ExternalBridgeVault.sol is no longer in the source tree, this script
 * does NOT compile or deploy a new implementation. Instead, it reuses the
 * already-deployed original implementation address recorded in the deployment file.
 *
 * Also optionally clears stratoToRepresentation mappings that may have been set
 * while the proxy was running StratoBridge code. Use CLEAR_MAPPINGS=true to
 * attempt this BEFORE the revert (otherwise the storage slots become dormant
 * but occupied after revert).
 *
 * Usage:
 *   node scripts/revertExternalBridgeVault.js --network sepolia
 *   node scripts/revertExternalBridgeVault.js --network baseSepolia --apply
 *   node scripts/revertExternalBridgeVault.js --network baseSepolia --apply --clear-mappings
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

// =============================================================================
// Config
// =============================================================================

const CHAIN_NAME_TO_ID = {
  sepolia: 11155111,
  baseSepolia: 84532,
};

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// STRATO-native token addresses that may have been mapped during StratoBridge upgrade
const STRATO_NATIVE_TOKENS = {
  USDST:  "0x000000000000000000000000937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  GOLDST: "0x000000000000000000000000cdc93d30182125e05eec985b631c7c61b3f63ff0",
  SILVST: "0x0000000000000000000000002c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
};

const UUPS_ABI = [
  "function upgradeToAndCall(address newImplementation, bytes calldata data)",
];

// StratoBridge's setTokenMapping — used only if --clear-mappings is set, while
// the proxy is still running StratoBridge code
const STRATO_BRIDGE_ABI = [
  "function setTokenMapping(address stratoToken, address representationToken)",
  "function stratoToRepresentation(address stratoToken) view returns (address)",
  "function version() view returns (string)",
];

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = { apply: false, network: null, clearMappings: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    if (argv[i] === "--clear-mappings") args.clearMappings = true;
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

// =============================================================================
// Main
// =============================================================================

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

  const rpcUrl = process.env[`CHAIN_${chainId}_RPC_URL`];
  if (!rpcUrl) {
    console.error(`ERROR: CHAIN_${chainId}_RPC_URL is required`);
    process.exit(1);
  }

  // Load deployment file — the original implementation address is what we revert to
  const vaultDeployment = loadDeployment("ExternalBridgeVault", args.network);
  if (!vaultDeployment) {
    console.error(`ERROR: deployments/ExternalBridgeVault_${args.network}_latest.json not found`);
    process.exit(1);
  }

  const proxyAddress = ethers.getAddress(vaultDeployment.addresses.proxy);
  const originalImpl = ethers.getAddress(vaultDeployment.addresses.implementation);

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const currentImplRaw = await provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT);
  const currentImpl = ethers.getAddress("0x" + currentImplRaw.slice(-40));

  console.log("=".repeat(60));
  console.log("REVERT ExternalBridgeVault Proxy");
  console.log("=".repeat(60));
  console.log(`Network:           ${args.network} (${chainId})`);
  console.log(`Proxy:             ${proxyAddress}`);
  console.log(`Current impl:      ${currentImpl}`);
  console.log(`Target impl:       ${originalImpl}  (from deployment file)`);
  console.log(`Safe:              ${safeAddress}`);
  console.log(`Apply:             ${args.apply}`);
  console.log(`Clear mappings:    ${args.clearMappings}`);
  console.log();

  const alreadyReverted =
    currentImpl.toLowerCase() === originalImpl.toLowerCase();

  if (alreadyReverted) {
    console.log("Proxy is already on the original ExternalBridgeVault implementation.");
    console.log("Nothing to revert.");
    if (args.clearMappings) {
      console.log(
        "\nWARNING: --clear-mappings was requested but the proxy is already reverted.\n" +
        "  The current ExternalBridgeVault impl does not expose setTokenMapping, so\n" +
        "  any existing stratoToRepresentation storage slots are dormant but unreachable.",
      );
    }
    return;
  }

  console.log(
    `Proxy is NOT on the original implementation. Assuming current impl is\n` +
    `StratoBridge (or another variant).`,
  );

  // =========================================================================
  // Step 1 (optional): Clear token mappings via StratoBridge.setTokenMapping
  // =========================================================================

  const transactions = [];

  if (args.clearMappings) {
    console.log("\nStep 1: Checking existing stratoToRepresentation mappings...");

    // Check what's actually mapped — the StratoBridge setTokenMapping rejects
    // zero addresses, so we can only "clear" by setting to a placeholder address.
    // Since reverting the impl makes these slots dormant anyway, we instead just
    // REPORT what's set and let the user decide.
    const stratoBridge = new ethers.Contract(proxyAddress, STRATO_BRIDGE_ABI, provider);

    let foundAny = false;
    for (const [symbol, stratoAddr] of Object.entries(STRATO_NATIVE_TOKENS)) {
      try {
        const repToken = await stratoBridge.stratoToRepresentation(stratoAddr);
        if (repToken !== ethers.ZeroAddress) {
          console.log(`  ${symbol}: mapped to ${repToken}`);
          foundAny = true;
        } else {
          console.log(`  ${symbol}: not mapped`);
        }
      } catch (e) {
        console.log(`  ${symbol}: unreadable (${e.shortMessage || e.message})`);
      }
    }

    if (foundAny) {
      console.log(
        "\n  NOTE: StratoBridge.setTokenMapping reverts on zero address, so these\n" +
        "  cannot be nulled through the normal setter. After the revert to\n" +
        "  ExternalBridgeVault, these storage slots will still contain the old\n" +
        "  values but they are unreachable by any ExternalBridgeVault function.\n" +
        "  They only become readable/writable again if you re-upgrade to StratoBridge.",
      );
    }
  }

  // =========================================================================
  // Step 2: Propose upgradeToAndCall(originalImpl, 0x) via Safe
  // =========================================================================

  console.log("\nStep 2: Building revert upgrade transaction...");

  const uupsIface = new ethers.Interface(UUPS_ABI);
  const upgradeData = uupsIface.encodeFunctionData("upgradeToAndCall", [
    originalImpl,
    "0x",
  ]);

  const tx = {
    to: proxyAddress,
    value: "0",
    data: upgradeData,
    operation: 0,
    meta: { method: "upgradeToAndCall", args: [originalImpl, "0x"] },
  };

  transactions.push(tx);

  console.log(`  [0] upgradeToAndCall(${originalImpl}, 0x)`);
  console.log(`      target: ${proxyAddress}`);

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to submit Safe proposal.");
    const outputPath = writeOutput(`revert-vault-${args.network}`, {
      network: args.network,
      chainId,
      proxy: proxyAddress,
      currentImplementation: currentImpl,
      targetImplementation: originalImpl,
      transactionCount: transactions.length,
      transactions: transactions.map((t) => ({ to: t.to, ...t.meta })),
    });
    console.log(`Output: ${outputPath}`);
    return;
  }

  // =========================================================================
  // Submit
  // =========================================================================

  console.log("\nStep 3: Submitting Safe proposal...");
  try {
    const result = await proposeBatch(
      chainId,
      [{ to: tx.to, value: tx.value, data: tx.data, operation: tx.operation }],
      { safeAddress },
    );
    console.log(`  Safe proposal submitted`);
    console.log(`    safeTxHash: ${result.safeTxHash}`);
    console.log(`    nonce:      ${result.nonce}`);
  } catch (error) {
    console.error(`  Safe proposal FAILED: ${error.message}`);
    console.log(`\n  You can manually propose via Safe UI:`);
    console.log(`    Target: ${proxyAddress}`);
    console.log(`    Method: upgradeToAndCall(${originalImpl}, 0x)`);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("REVERT SUMMARY");
  console.log("=".repeat(60));
  console.log(`Proxy:         ${proxyAddress}`);
  console.log(`From impl:     ${currentImpl}`);
  console.log(`To impl:       ${originalImpl} (original ExternalBridgeVault)`);
  console.log(`Status:        Proposed — approve in Safe UI`);
  console.log();
  console.log("After Safe approval:");
  console.log("  1. Verify: cast storage <proxy> 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  console.log(`     (should return ${originalImpl})`);
  console.log(`  2. Run: node scripts/verifyBridgeConfig.js --network ${args.network}`);
}

main().catch((error) => {
  console.error("\nRevert failed:", error.message);
  process.exit(1);
});
