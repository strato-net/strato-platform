const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");
const {
  getChainEnvName,
  getDeploymentConfirmations,
  getDeploymentProfile,
  parseDeployArgs,
} = require("./lib/externalBridgeDeploymentConfig");

const { writeCheckpoint, openDeploymentCheckpoint, resumeProxyDeployment } = require("./lib/deploymentCheckpoint");

const DEFAULT_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function requiredChainAddress(chainId, name, fallback) {
  const envName = getChainEnvName(chainId, name);
  const value = process.env[envName] || fallback;
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${envName} must be a nonzero address`);
  }
  return ethers.getAddress(value);
}

function writeOutput(payload, artifactPrefix, rolloutDir) {
  const directory = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    directory,
    `${artifactPrefix}_${timestamp}.json`,
  );
  const latestPath = path.join(directory, `${artifactPrefix}_latest.json`);
  for (const file of [outputPath, latestPath]) writeCheckpoint(file, payload);
  let rolloutPath;
  if (rolloutDir) {
    fs.mkdirSync(path.resolve(rolloutDir), { recursive: true, mode: 0o700 });
    rolloutPath = path.resolve(rolloutDir, "external-deployment.json");
    writeCheckpoint(rolloutPath, payload);
  }
  return { outputPath, latestPath, rolloutPath };
}

async function main() {
  const { execute, rolloutDir } = parseDeployArgs(process.argv.slice(2));
  const network = await ethers.provider.getNetwork();
  const profile = getDeploymentProfile(network.chainId, process.env, {
    execute,
  });
  const chainId = profile.chainId;
  const deploymentConfirmations = getDeploymentConfirmations(
    chainId,
    process.env,
  );
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
    deploymentConfirmations,
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

  const artifactDirectory = path.resolve(__dirname, "../deployments");
  const latestPath = path.join(artifactDirectory, `${profile.artifactPrefix}_latest.json`);
  const artifactFiles = [latestPath, ...(rolloutDir ? [path.resolve(rolloutDir, "external-deployment.json")] : [])];
  const journal = openDeploymentCheckpoint(
    path.join(artifactDirectory, `${profile.artifactPrefix}_checkpoint.json`),
    { chainId: String(chainId), deployerAddress, safeAddress, permit2Address, roles: preflight.roles,
      deploymentConfirmations, vaultBuild: ethers.keccak256(vaultFactory.bytecode), routerBuild: ethers.keccak256(routerFactory.bytecode) },
    artifactFiles,
  );
  try {
  for (const file of artifactFiles) {
    if (!fs.existsSync(file)) continue;
    const artifact = JSON.parse(fs.readFileSync(file, "utf8"));
    if (artifact.chainId !== String(chainId) || artifact.externalBridgeVault?.proxy !== journal.state.steps.vault?.proxy ||
        artifact.depositRouter?.proxy !== journal.state.steps.router?.proxy) {
      throw new Error("Canonical deployment artifact conflicts with checkpoint; refusing to overwrite");
    }
  }
  const vaultRoles = [
    ["DEFAULT_ADMIN_ROLE", vaultDefaultAdminAddress], ["UPGRADER_ROLE", vaultUpgraderAddress],
    ["POLICY_ADMIN_ROLE", vaultPolicyAdminAddress], ["PAUSER_ROLE", guardianAddress],
    ["UNPAUSER_ROLE", vaultUnpauserAddress], ["ATTESTATION_ADMIN_ROLE", vaultAttestationAdminAddress],
    ["LARGE_WITHDRAWAL_APPROVER_ROLE", largeWithdrawalApproverAddress],
  ];
  const vaultDeployment = await resumeProxyDeployment(journal, "vault", () => upgrades.deployProxy(
    vaultFactory, vaultRoles.map(([, address]) => address), { kind: "uups" },
  ), vaultFactory, ethers.provider, upgrades, deploymentConfirmations, async contract => {
    for (const [role, address] of vaultRoles) {
      if (!await contract.hasRole(await contract[role](), address)) throw new Error(`Vault ${role} configuration mismatch`);
    }
  });
  const vault = vaultDeployment.contract;
  const vaultAddress = await vault.getAddress();
  const vaultDeploymentReceipt = vaultDeployment.receipt;
  const vaultImplementation = vaultDeployment.implementation;
  const routerDeployment = await resumeProxyDeployment(journal, "router", () => upgrades.deployProxy(
    routerFactory, [permit2Address, vaultAddress, safeAddress], { kind: "uups" },
  ), routerFactory, ethers.provider, upgrades, deploymentConfirmations, async contract => {
    if (await contract.version() !== "3.2.0" || await contract.owner() !== safeAddress ||
        await contract.externalBridgeVault() !== vaultAddress || await contract.PERMIT2() !== permit2Address) {
      throw new Error("Router configuration mismatch");
    }
  });
  const router = routerDeployment.contract;
  const depositRouterAddress = await router.getAddress();
  const routerDeploymentReceipt = routerDeployment.receipt;
  const depositRouterImplementation = routerDeployment.implementation;

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
    deployedAt: journal.state.deployedAt || new Date().toISOString(),
    safeAddress,
    vaultDefaultAdminAddress,
    vaultUpgraderAddress,
    vaultPolicyAdminAddress,
    guardianAddress,
    vaultUnpauserAddress,
    vaultAttestationAdminAddress,
    largeWithdrawalApproverAddress,
    permit2Address,
    deploymentConfirmations,
    externalBridgeVaultDeploymentBlock: vaultDeploymentReceipt.blockNumber,
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
  journal.state.deployedAt = payload.deployedAt;
  journal.state.verification = verification;
  journal.save();
  const paths = writeOutput(payload, profile.artifactPrefix, rolloutDir);
  journal.state.status = "complete";
  journal.save();
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Output: ${paths.outputPath}`);
  console.log(`Latest: ${paths.latestPath}`);
  if (paths.rolloutPath) console.log(`Rollout: ${paths.rolloutPath}`);
  } finally { journal.close(); }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`deployExternalBridge failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = main;
