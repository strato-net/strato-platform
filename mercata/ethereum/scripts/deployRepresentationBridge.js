/**
 * Deploy StratoRepresentationBridge as a UUPS proxy on an external chain.
 *
 * Usage:
 *   SAFE_ADDRESS=0x... npx hardhat run scripts/deployRepresentationBridge.js --network sepolia
 *
 * One deployment per external chain. After deployment:
 *   1. Grant BRIDGE_OPERATOR_ROLE to relayer EOA
 *   2. Grant MINTER_ROLE on each StratoRepresentationToken to this bridge
 *   3. Register token mappings via setTokenMapping()
 *   4. Configure rate limits via setMintRateLimit/setBurnRateLimit
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

  console.log("=== Deploy StratoRepresentationBridge ===");
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Safe (admin): ${safeAddress}`);

  if (balance === 0n) throw new Error("Deployer has no ETH balance");

  const Factory = await ethers.getContractFactory("StratoRepresentationBridge");

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

  const deploymentsDir = path.resolve("deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const info = {
    contractName: "StratoRepresentationBridge",
    network: { name: network.name, chainId: network.chainId.toString() },
    addresses: { proxy: proxyAddress, implementation: implAddress },
    admin: safeAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const filename = `StratoRepresentationBridge_${network.name}_latest.json`;
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(info, null, 2));
  console.log(`\nSaved: deployments/${filename}`);

  console.log("\n--- Next Steps ---");
  console.log(`1. Grant BRIDGE_OPERATOR_ROLE to relayer EOA`);
  console.log(`2. Grant MINTER_ROLE on each StratoRepresentationToken to ${proxyAddress}`);
  console.log(`3. Register token mappings: setTokenMapping(<stratoAddr>, <repTokenAddr>)`);
  console.log(`4. Set rate limits: setMintRateLimit / setBurnRateLimit per token`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
