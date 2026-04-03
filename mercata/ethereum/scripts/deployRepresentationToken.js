/**
 * Deploy a StratoRepresentationToken as a UUPS proxy on an external chain.
 *
 * Usage:
 *   SAFE_ADDRESS=0x... TOKEN_NAME=USDST TOKEN_SYMBOL=USDST \
 *     npx hardhat run scripts/deployRepresentationToken.js --network sepolia
 *
 * Deploy one per STRATO-native asset (USDST, GOLDST, SILVST) per chain.
 */
const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const safeAddress = process.env.SAFE_ADDRESS;
  const tokenName = process.env.TOKEN_NAME;
  const tokenSymbol = process.env.TOKEN_SYMBOL;

  if (!safeAddress || !tokenName || !tokenSymbol) {
    console.error("ERROR: Required env vars: SAFE_ADDRESS, TOKEN_NAME, TOKEN_SYMBOL");
    console.error('Example: SAFE_ADDRESS=0x... TOKEN_NAME=USDST TOKEN_SYMBOL=USDST npx hardhat run scripts/deployRepresentationToken.js --network sepolia');
    process.exit(1);
  }

  const network = await ethers.provider.getNetwork();
  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  console.log(`=== Deploy StratoRepresentationToken: ${tokenSymbol} ===`);
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
  console.log(`Safe (admin): ${safeAddress}`);
  console.log(`Token: ${tokenName} (${tokenSymbol})`);

  if (balance === 0n) throw new Error("Deployer has no ETH balance");

  const Factory = await ethers.getContractFactory("StratoRepresentationToken");

  console.log("\nDeploying proxy + implementation...");
  const proxy = await upgrades.deployProxy(
    Factory,
    [tokenName, tokenSymbol, safeAddress],
    { initializer: "initialize", kind: "uups" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("\n=== Deployment Successful ===");
  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Implementation: ${implAddress}`);

  const deploymentsDir = path.resolve("deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const info = {
    contractName: "StratoRepresentationToken",
    tokenName,
    tokenSymbol,
    network: { name: network.name, chainId: network.chainId.toString() },
    addresses: { proxy: proxyAddress, implementation: implAddress },
    admin: safeAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const filename = `StratoRepresentationToken_${tokenSymbol}_${network.name}_latest.json`;
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(info, null, 2));
  console.log(`\nSaved: deployments/${filename}`);

  console.log("\n--- Next Steps ---");
  console.log(`1. Deploy StratoRepresentationBridge (if not already deployed)`);
  console.log(`2. Grant MINTER_ROLE on this token to the StratoRepresentationBridge`);
  console.log(`3. Register token mapping on the bridge: setTokenMapping(<stratoTokenAddr>, ${proxyAddress})`);
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
