/**
 * Deploy ExternalBridgeVault as a UUPS proxy on an external chain.
 *
 * Usage:
 *   SAFE_ADDRESS=0x... npx hardhat run scripts/deployBridgeVault.js --network sepolia
 *   SAFE_ADDRESS=0x... npx hardhat run scripts/deployBridgeVault.js --network baseSepolia
 *
 * The SAFE_ADDRESS is granted DEFAULT_ADMIN_ROLE (governance owner).
 */
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) {
    console.error("ERROR: SAFE_ADDRESS environment variable is required");
    process.exit(1);
  }

  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  console.log("=== Deploy ExternalBridgeVault ===");
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Safe (admin): ${safeAddress}`);

  if (balance === 0n) throw new Error("Deployer has no ETH balance");

  const Factory = await ethers.getContractFactory("ExternalBridgeVault");

  console.log("\nDeploying proxy + implementation...");
  const proxy = await upgrades.deployProxy(Factory, [safeAddress], {
    initializer: "initialize",
    kind: "uups",
  });
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n=== Deployment Successful ===");
  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Implementation: ${implAddress}`);

  // Save deployment info
  const deploymentsDir = path.resolve("deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const info = {
    contractName: "ExternalBridgeVault",
    network: { name: network.name, chainId: network.chainId.toString() },
    addresses: { proxy: proxyAddress, implementation: implAddress },
    admin: safeAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const filename = `ExternalBridgeVault_${network.name}_latest.json`;
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(info, null, 2));
  console.log(`\nSaved: deployments/${filename}`);

  console.log("\n--- Next Steps ---");
  console.log(`1. Grant BRIDGE_OPERATOR_ROLE to relayer EOA:`);
  console.log(`   VAULT=${proxyAddress} OPERATOR=<relayer_address> npx hardhat run scripts/configureBridgeRoles.js --network ${network.name}`);
  console.log(`2. Configure rate limits per token`);
  console.log(`3. Update DepositRouter to point to this vault`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
