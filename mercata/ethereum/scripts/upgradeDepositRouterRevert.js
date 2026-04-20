/**
 * Deploy a fresh DepositRouter implementation and upgrade the DepositRouter proxy
 * to point to it. Use this to ensure the proxy is running the current source code
 * in contracts/bridge/DepositRouter.sol (e.g., reverting a previous upgrade to a
 * different implementation like StratoBridge).
 *
 * Dry-run by default (validates storage layout). Use APPLY=true to execute.
 *
 * Usage:
 *   npx hardhat run scripts/upgradeDepositRouterRevert.js --network sepolia
 *   npx hardhat run scripts/upgradeDepositRouterRevert.js --network baseSepolia
 *   APPLY=true npx hardhat run scripts/upgradeDepositRouterRevert.js --network sepolia
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

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const UUPS_ABI = [
  "function upgradeToAndCall(address newImplementation, bytes calldata data)",
];

function saveDeployment(contractName, networkName, data) {
  const deploymentsDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = path.join(deploymentsDir, `${contractName}_${networkName}_${timestamp}.json`);
  const latestPath = path.join(deploymentsDir, `${contractName}_${networkName}_latest.json`);

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(data, null, 2));
  console.log(`  Saved: ${path.basename(latestPath)}`);
}

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
  console.log("UPGRADE DepositRouter Proxy → Current DepositRouter Code");
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

  // Validate the upgrade
  console.log("Step 1: Validating storage layout compatibility...");
  const DepositRouter = await ethers.getContractFactory("DepositRouter");

  try {
    await upgrades.forceImport(proxyAddress, DepositRouter, { kind: "uups" });
    console.log("  Imported existing proxy");
  } catch (e) {
    if (!e.message.includes("already")) {
      console.log(`  Import note: ${e.message}`);
    }
  }

  try {
    await upgrades.validateUpgrade(proxyAddress, DepositRouter, {
      kind: "uups",
      unsafeAllowRenames: true,
    });
    console.log("  Storage layout compatible ✓");
  } catch (e) {
    console.error(`  Storage layout INCOMPATIBLE: ${e.message}`);
    console.error(`  Cannot safely revert. Current impl may have added storage that cannot be discarded.`);
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with APPLY=true to deploy and propose upgrade.");
    const outputPath = writeOutput(`upgrade-dr-revert-${networkName}`, {
      network: networkName,
      chainId,
      proxy: proxyAddress,
      currentImplementation: currentImpl,
      status: "dry-run-validated",
    });
    console.log(`Output: ${outputPath}`);
    return;
  }

  // Deploy fresh implementation
  console.log("\nStep 2: Deploying fresh DepositRouter implementation...");
  const implTx = await DepositRouter.deploy();
  await implTx.waitForDeployment();
  const newImplAddress = await implTx.getAddress();
  console.log(`  Implementation deployed: ${newImplAddress}`);

  saveDeployment("DepositRouter_implementation", networkName, {
    contractName: "DepositRouter",
    network: { name: networkName, chainId: chainId.toString() },
    implementation: newImplAddress,
    proxy: proxyAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  });

  if (currentImpl.toLowerCase() === newImplAddress.toLowerCase()) {
    console.log("\n  Proxy already points to a DepositRouter impl with the same bytecode.");
    console.log("  Skipping Safe proposal.");
    return;
  }

  // Propose upgrade via Safe (no initializer call — DepositRouter already initialized)
  console.log("\nStep 3: Proposing proxy upgrade via Safe...");

  const uupsIface = new ethers.Interface(UUPS_ABI);
  const upgradeData = uupsIface.encodeFunctionData("upgradeToAndCall", [
    newImplAddress,
    "0x",
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

    saveDeployment("DepositRouter_revert_upgrade", networkName, {
      contractName: "DepositRouter",
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
    console.log(`    Method:  upgradeToAndCall(${newImplAddress}, 0x)`);
    process.exit(1);
  }

  // Best-effort verification
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

  console.log("\n" + "=".repeat(60));
  console.log("UPGRADE SUMMARY");
  console.log("=".repeat(60));
  console.log(`Proxy:              ${proxyAddress}`);
  console.log(`Previous impl:      ${currentImpl}`);
  console.log(`New impl:           ${newImplAddress} (DepositRouter)`);
  console.log(`Safe proposal:      Submitted — approve in Safe UI`);
}

main().catch((error) => {
  console.error("\nUpgrade failed:", error.message);
  process.exit(1);
});
