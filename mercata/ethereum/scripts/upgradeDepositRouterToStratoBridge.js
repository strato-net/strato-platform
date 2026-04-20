/**
 * Upgrade the old DepositRouter proxy to StratoBridge on testnet.
 *
 * This targets the DepositRouter proxy specifically (via CHAIN_<id>_DEPOSIT_ROUTER),
 * unlike upgradeVaultToStratoBridge.js which targets the ExternalBridgeVault proxy.
 *
 * The upgrade bundles initializeV2(admin) which sets up AccessControl roles.
 * Token configs (tokenConfig, routePermitted) are preserved in storage since
 * StratoBridge's layout is compatible with DepositRouter.
 *
 * Dry-run by default (validates storage layout). Use APPLY=true to execute.
 *
 * Usage:
 *   npx hardhat run scripts/upgradeDepositRouterToStratoBridge.js --network sepolia
 *   npx hardhat run scripts/upgradeDepositRouterToStratoBridge.js --network baseSepolia
 *   APPLY=true npx hardhat run scripts/upgradeDepositRouterToStratoBridge.js --network sepolia
 */
const hre = require("hardhat");
const { ethers, upgrades } = hre;
const fs = require("fs");
const path = require("path");

require("dotenv").config();
require("dotenv").config({
  path: path.resolve(__dirname, "../../services/bridge/.env"),
});

const {
  proposeBatch,
  writeOutput,
} = require("./lib/depositRouterSafeOps");

// =============================================================================
// Config
// =============================================================================

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const UUPS_ABI = [
  "function upgradeToAndCall(address newImplementation, bytes calldata data)",
];

const STRATO_BRIDGE_ABI = [
  "function initializeV2(address admin_)",
];

// =============================================================================
// Helpers
// =============================================================================

function saveDeployment(contractName, networkName, data) {
  const deploymentsDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = path.join(deploymentsDir, `${contractName}_${networkName}_${timestamp}.json`);
  const latestPath = path.join(deploymentsDir, `${contractName}_${networkName}_latest.json`);

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(data, null, 2));
  console.log(`Saved: ${filepath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const apply = process.env.APPLY === "true";

  const network = await ethers.provider.getNetwork();
  const networkName = hre.network.name;
  const chainId = Number(network.chainId);

  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) {
    console.error("ERROR: SAFE_ADDRESS is required");
    process.exit(1);
  }

  const proxyAddress = process.env[`CHAIN_${chainId}_DEPOSIT_ROUTER`];
  if (!proxyAddress) {
    console.error(`ERROR: CHAIN_${chainId}_DEPOSIT_ROUTER env var is required`);
    process.exit(1);
  }

  const currentImpl = ethers.getAddress(
    "0x" + (await ethers.provider.getStorage(proxyAddress, ERC1967_IMPLEMENTATION_SLOT)).slice(-40),
  );

  console.log("=".repeat(60));
  console.log("UPGRADE DepositRouter → StratoBridge");
  console.log("=".repeat(60));
  console.log(`Network:          ${networkName} (${chainId})`);
  console.log(`Deployer:         ${deployer.address}`);
  console.log(`Balance:          ${ethers.formatEther(balance)} ETH`);
  console.log(`Safe:             ${safeAddress}`);
  console.log(`Proxy:            ${proxyAddress}`);
  console.log(`Current impl:     ${currentImpl}`);
  console.log(`Apply:            ${apply}`);
  console.log();

  if (balance === 0n) {
    console.error("Deployer has no ETH balance");
    process.exit(1);
  }

  // =========================================================================
  // Step 1: Register existing proxy and validate storage compatibility
  // =========================================================================

  console.log("Step 1: Validating storage layout compatibility...");

  const DepositRouter = await ethers.getContractFactory("DepositRouter");
  try {
    await upgrades.forceImport(proxyAddress, DepositRouter, { kind: "uups" });
    console.log("  Imported existing DepositRouter proxy");
  } catch (e) {
    if (!e.message.includes("already")) {
      console.log(`  Import note: ${e.message}`);
    }
  }

  const StratoBridge = await ethers.getContractFactory("StratoBridge");

  try {
    await upgrades.validateUpgrade(proxyAddress, StratoBridge, {
      kind: "uups",
      unsafeAllowRenames: true,
    });
    console.log("  Storage layout compatible ✓");
  } catch (e) {
    console.error(`  Storage layout INCOMPATIBLE: ${e.message}`);
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry run complete. No transactions submitted.");
    console.log("Re-run with APPLY=true to deploy implementation and propose upgrade.");

    const outputPath = writeOutput(`upgrade-dr-to-strato-bridge-${networkName}`, {
      network: networkName,
      chainId,
      proxy: proxyAddress,
      currentImplementation: currentImpl,
      status: "dry-run-validated",
    });
    console.log(`Output: ${outputPath}`);
    return;
  }

  // =========================================================================
  // Step 2: Deploy StratoBridge implementation
  // =========================================================================

  console.log("\nStep 2: Deploying StratoBridge implementation...");

  const implTx = await StratoBridge.deploy();
  await implTx.waitForDeployment();
  const newImplAddress = await implTx.getAddress();
  console.log(`  Implementation deployed: ${newImplAddress}`);

  saveDeployment("StratoBridge_DR_implementation", networkName, {
    contractName: "StratoBridge",
    upgradeFrom: "DepositRouter",
    network: { name: networkName, chainId: chainId.toString() },
    implementation: newImplAddress,
    proxy: proxyAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  });

  // =========================================================================
  // Step 3: Propose upgradeToAndCall(newImpl, initializeV2(safe)) via Safe
  // =========================================================================

  console.log("\nStep 3: Proposing proxy upgrade via Safe...");

  const stratoBridgeIface = new ethers.Interface(STRATO_BRIDGE_ABI);
  const initData = stratoBridgeIface.encodeFunctionData("initializeV2", [
    ethers.getAddress(safeAddress),
  ]);

  const uupsIface = new ethers.Interface(UUPS_ABI);
  const upgradeData = uupsIface.encodeFunctionData("upgradeToAndCall", [
    newImplAddress,
    initData,
  ]);

  const tx = {
    to: ethers.getAddress(proxyAddress),
    value: "0",
    data: upgradeData,
    operation: 0,
  };

  try {
    const result = await proposeBatch(chainId, [tx], { safeAddress });
    console.log(`  Safe proposal submitted`);
    console.log(`    safeTxHash: ${result.safeTxHash}`);
    console.log(`    nonce:      ${result.nonce}`);

    saveDeployment("StratoBridge_DR_upgrade", networkName, {
      contractName: "StratoBridge",
      upgradeFrom: "DepositRouter",
      network: { name: networkName, chainId: chainId.toString() },
      proxy: proxyAddress,
      previousImplementation: currentImpl,
      newImplementation: newImplAddress,
      safeTxHash: result.safeTxHash,
      safeNonce: result.nonce,
      deployer: deployer.address,
      deployedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(`  Safe proposal FAILED: ${error.message}`);
    console.log(`\n  Implementation is deployed at ${newImplAddress}`);
    console.log(`  You can manually propose via Safe UI:`);
    console.log(`    Target:  ${proxyAddress}`);
    console.log(`    Method:  upgradeToAndCall(${newImplAddress}, <initData>)`);
    console.log(`    initData: ${initData}`);
    process.exit(1);
  }

  // =========================================================================
  // Step 4: Verify implementation (best-effort)
  // =========================================================================

  console.log("\nStep 4: Verifying implementation on block explorer...");
  try {
    await hre.run("verify:verify", {
      address: newImplAddress,
      constructorArguments: [],
    });
    console.log("  Verification successful ✓");
  } catch (e) {
    console.log(`  Verification skipped: ${e.message}`);
  }

  // =========================================================================
  // Summary
  // =========================================================================

  console.log("\n" + "=".repeat(60));
  console.log("UPGRADE SUMMARY");
  console.log("=".repeat(60));
  console.log(`Proxy:              ${proxyAddress}`);
  console.log(`Previous impl:      ${currentImpl} (DepositRouter)`);
  console.log(`New impl:           ${newImplAddress} (StratoBridge)`);
  console.log(`initializeV2:       Bundled — grants DEFAULT_ADMIN_ROLE to Safe`);
  console.log(`Token configs:      Preserved in storage (same slot layout)`);
  console.log();
  console.log("After Safe approval:");
  console.log("  1. Verify: StratoBridge.version() == '3.0.0'");
  console.log("  2. Configure roles + rep token mappings:");
  console.log(`     node scripts/configureStratoBridge.js --network ${networkName} --apply`);
  console.log("  3. Set rate limits:");
  console.log(`     node scripts/setVaultRateLimits.js --network ${networkName} --apply`);
}

main().catch((error) => {
  console.error("\nUpgrade failed:", error.message);
  process.exit(1);
});
