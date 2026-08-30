const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

const SEPOLIA_CHAIN_ID = 11155111n;
const DEFAULT_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function requiredAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a nonzero address`);
  }
  return ethers.getAddress(value);
}

function writeOutput(payload) {
  const directory = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    directory,
    `ExternalBridgeTestnetPair_sepolia_${timestamp}.json`,
  );
  const latestPath = path.join(
    directory,
    "ExternalBridgeTestnetPair_sepolia_latest.json",
  );
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
  return { outputPath, latestPath };
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `This script only deploys to Sepolia (${SEPOLIA_CHAIN_ID}); connected to ${network.chainId}`,
    );
  }
  const safeAddress = requiredAddress("SAFE_ADDRESS");
  const guardianAddress = requiredAddress("GUARDIAN_ADDRESS");
  const permit2Address = requiredAddress("PERMIT2_ADDRESS", DEFAULT_PERMIT2);
  if ((await ethers.provider.getCode(permit2Address)) === "0x") {
    throw new Error(`PERMIT2_ADDRESS has no bytecode: ${permit2Address}`);
  }

  const vault = await upgrades.deployProxy(
    await ethers.getContractFactory("ExternalBridgeVault"),
    [safeAddress, guardianAddress],
    { kind: "uups" },
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  const vaultImplementation = await upgrades.erc1967.getImplementationAddress(
    vaultAddress,
  );

  const router = await upgrades.deployProxy(
    await ethers.getContractFactory("DepositRouter"),
    [permit2Address, vaultAddress, safeAddress],
    { kind: "uups" },
  );
  await router.waitForDeployment();
  const depositRouterAddress = await router.getAddress();
  const depositRouterImplementation =
    await upgrades.erc1967.getImplementationAddress(depositRouterAddress);

  const verification = {
    depositRouterVersion: await router.version(),
    depositRouterOwner: await router.owner(),
    depositRouterVault: await router.externalBridgeVault(),
  };
  if (
    verification.depositRouterVersion !== "3.2.0" ||
    verification.depositRouterOwner !== safeAddress ||
    verification.depositRouterVault !== vaultAddress
  ) {
    throw new Error("Post-deployment verification failed");
  }

  const payload = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    safeAddress,
    guardianAddress,
    permit2Address,
    externalBridgeVault: {
      proxy: vaultAddress,
      implementation: vaultImplementation,
    },
    depositRouter: {
      proxy: depositRouterAddress,
      implementation: depositRouterImplementation,
    },
    verification,
  };
  const paths = writeOutput(payload);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Output: ${paths.outputPath}`);
  console.log(`Latest: ${paths.latestPath}`);
}

main().catch((error) => {
  console.error(`deployExternalBridgeTestnet failed: ${error.message}`);
  process.exitCode = 1;
});
