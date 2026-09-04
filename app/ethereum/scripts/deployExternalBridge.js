const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");
const {
  getChainEnvName,
  getDeploymentProfile,
  parseDeployArgs,
} = require("./lib/externalBridgeDeploymentConfig");

const DEFAULT_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function requiredChainAddress(chainId, name, fallback) {
  const envName = getChainEnvName(chainId, name);
  const value = process.env[envName] || fallback;
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${envName} must be a nonzero address`);
  }
  return ethers.getAddress(value);
}

function writeOutput(payload, artifactPrefix) {
  const directory = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    directory,
    `${artifactPrefix}_${timestamp}.json`,
  );
  const latestPath = path.join(directory, `${artifactPrefix}_latest.json`);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));
  return { outputPath, latestPath };
}

async function main() {
  const { execute } = parseDeployArgs(process.argv.slice(2));
  const network = await ethers.provider.getNetwork();
  const profile = getDeploymentProfile(network.chainId, process.env, {
    execute,
  });
  const chainId = profile.chainId;
  const safeAddress = requiredChainAddress(chainId, "SAFE_ADDRESS");
  const vaultDefaultAdminAddress = requiredChainAddress(
    chainId,
    "VAULT_DEFAULT_ADMIN_ADDRESS",
  );
  const vaultUpgraderAddress = requiredChainAddress(
    chainId,
    "VAULT_UPGRADER_ADDRESS",
  );
  const vaultPolicyAdminAddress = requiredChainAddress(
    chainId,
    "VAULT_POLICY_ADMIN_ADDRESS",
  );
  const guardianAddress = requiredChainAddress(chainId, "GUARDIAN_ADDRESS");
  const vaultUnpauserAddress = requiredChainAddress(
    chainId,
    "VAULT_UNPAUSER_ADDRESS",
  );
  const vaultAttestationAdminAddress = requiredChainAddress(
    chainId,
    "VAULT_ATTESTATION_ADMIN_ADDRESS",
  );
  const largeWithdrawalApproverAddress = requiredChainAddress(
    chainId,
    "LARGE_WITHDRAWAL_APPROVER_ADDRESS",
  );
  const permit2Address = requiredChainAddress(
    chainId,
    "PERMIT2_ADDRESS",
    DEFAULT_PERMIT2,
  );
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("PRIVATE_KEY must configure a deployment signer");
  }
  const deployerAddress = await deployer.getAddress();
  const [
    deployerBalance,
    safeCode,
    permit2Code,
    vaultFactory,
    routerFactory,
  ] = await Promise.all([
    ethers.provider.getBalance(deployerAddress),
    ethers.provider.getCode(safeAddress),
    ethers.provider.getCode(permit2Address),
    ethers.getContractFactory("ExternalBridgeVault"),
    ethers.getContractFactory("DepositRouter"),
  ]);
  if (deployerBalance === 0n) {
    throw new Error(`Deployment signer ${deployerAddress} has zero balance`);
  }
  if (safeCode === "0x") {
    throw new Error(`SAFE_ADDRESS has no bytecode: ${safeAddress}`);
  }
  if (permit2Code === "0x") {
    throw new Error(`PERMIT2_ADDRESS has no bytecode: ${permit2Address}`);
  }
  await Promise.all([
    upgrades.validateImplementation(vaultFactory, { kind: "uups" }),
    upgrades.validateImplementation(routerFactory, { kind: "uups" }),
  ]);

  const preflight = {
    mode: execute ? "execute" : "preflight",
    network: profile.network,
    chainId: network.chainId.toString(),
    production: profile.production,
    deployerAddress,
    deployerBalanceWei: deployerBalance.toString(),
    safeAddress,
    permit2Address,
    roles: {
      vaultDefaultAdminAddress,
      vaultUpgraderAddress,
      vaultPolicyAdminAddress,
      guardianAddress,
      vaultUnpauserAddress,
      vaultAttestationAdminAddress,
      largeWithdrawalApproverAddress,
    },
    checks: {
      safeHasBytecode: true,
      permit2HasBytecode: true,
      implementationsAreUupsSafe: true,
    },
  };
  console.log(JSON.stringify(preflight, null, 2));
  if (!execute) {
    console.log("Preflight passed. Re-run with --execute to deploy.");
    return;
  }

  const vault = await upgrades.deployProxy(
    vaultFactory,
    [
      vaultDefaultAdminAddress,
      vaultUpgraderAddress,
      vaultPolicyAdminAddress,
      guardianAddress,
      vaultUnpauserAddress,
      vaultAttestationAdminAddress,
      largeWithdrawalApproverAddress,
    ],
    { kind: "uups" },
  );
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  const vaultImplementation = await upgrades.erc1967.getImplementationAddress(
    vaultAddress,
  );

  const router = await upgrades.deployProxy(
    routerFactory,
    [permit2Address, vaultAddress, safeAddress],
    { kind: "uups" },
  );
  await router.waitForDeployment();
  const routerDeploymentReceipt =
    await router.deploymentTransaction()?.wait();
  if (!routerDeploymentReceipt) {
    throw new Error("DepositRouter deployment receipt is unavailable");
  }
  const depositRouterAddress = await router.getAddress();
  const depositRouterImplementation =
    await upgrades.erc1967.getImplementationAddress(depositRouterAddress);

  const verification = {
    depositRouterVersion: await router.version(),
    depositRouterOwner: await router.owner(),
    depositRouterVault: await router.externalBridgeVault(),
    vaultDefaultAdmin: await vault.hasRole(
      await vault.DEFAULT_ADMIN_ROLE(),
      vaultDefaultAdminAddress,
    ),
    vaultUpgrader: await vault.hasRole(
      await vault.UPGRADER_ROLE(),
      vaultUpgraderAddress,
    ),
    vaultPolicyAdmin: await vault.hasRole(
      await vault.POLICY_ADMIN_ROLE(),
      vaultPolicyAdminAddress,
    ),
    vaultGuardian: await vault.hasRole(
      await vault.PAUSER_ROLE(),
      guardianAddress,
    ),
    vaultUnpauser: await vault.hasRole(
      await vault.UNPAUSER_ROLE(),
      vaultUnpauserAddress,
    ),
    vaultAttestationAdmin: await vault.hasRole(
      await vault.ATTESTATION_ADMIN_ROLE(),
      vaultAttestationAdminAddress,
    ),
    vaultLargeWithdrawalApprover: await vault.hasRole(
      await vault.LARGE_WITHDRAWAL_APPROVER_ROLE(),
      largeWithdrawalApproverAddress,
    ),
  };
  if (
    verification.depositRouterVersion !== "3.2.0" ||
    verification.depositRouterOwner !== safeAddress ||
    verification.depositRouterVault !== vaultAddress ||
    !verification.vaultDefaultAdmin ||
    !verification.vaultUpgrader ||
    !verification.vaultPolicyAdmin ||
    !verification.vaultGuardian ||
    !verification.vaultUnpauser ||
    !verification.vaultAttestationAdmin ||
    !verification.vaultLargeWithdrawalApprover
  ) {
    throw new Error("Post-deployment verification failed");
  }

  const payload = {
    network: profile.network,
    chainId: network.chainId.toString(),
    production: profile.production,
    deployedAt: new Date().toISOString(),
    safeAddress,
    vaultDefaultAdminAddress,
    vaultUpgraderAddress,
    vaultPolicyAdminAddress,
    guardianAddress,
    vaultUnpauserAddress,
    vaultAttestationAdminAddress,
    largeWithdrawalApproverAddress,
    permit2Address,
    depositRouterDeploymentBlock: routerDeploymentReceipt.blockNumber,
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
  const paths = writeOutput(payload, profile.artifactPrefix);
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Output: ${paths.outputPath}`);
  console.log(`Latest: ${paths.latestPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`deployExternalBridge failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = main;
