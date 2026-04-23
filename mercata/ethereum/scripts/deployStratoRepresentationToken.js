/**
 * Deploy a new StratoRepresentationToken (UUPS proxy) on an external chain and
 * wire it into the existing StratoRepresentationBridge via two Safe proposals:
 *   1. grantRole(MINTER_ROLE, repBridgeAddress)       on the new rep token
 *   2. setTokenMapping(stratoToken, newRepTokenAddr)  on the rep bridge
 *
 * Dry-run by default. Set APPLY=true to actually deploy and propose.
 *
 * Required env vars:
 *   SAFE_ADDRESS            Safe multisig (becomes DEFAULT_ADMIN of new token)
 *   STRATO_TOKEN_ADDRESS    STRATO-side address to map the new rep token to
 *   REP_TOKEN_NAME          ERC-20 name for the new rep token (e.g. "STRATO")
 *   REP_TOKEN_SYMBOL        ERC-20 symbol for the new rep token (e.g. "STRATO")
 *
 * Usage:
 *   REP_TOKEN_NAME=STRATO REP_TOKEN_SYMBOL=STRATO STRATO_TOKEN_ADDRESS=0x... \
 *     npx hardhat run scripts/deployStratoRepresentationToken.js --network sepolia
 *
 *   REP_TOKEN_NAME=STRATO REP_TOKEN_SYMBOL=STRATO STRATO_TOKEN_ADDRESS=0x... APPLY=true \
 *     npx hardhat run scripts/deployStratoRepresentationToken.js --network baseSepolia
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
// Constants
// =============================================================================

const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER"));

const ACCESS_CONTROL_ABI = [
  "function grantRole(bytes32 role, address account)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

const REP_BRIDGE_ABI = [
  "function setTokenMapping(address stratoToken, address representationToken)",
  "function stratoToRepresentation(address stratoToken) view returns (address)",
];

// =============================================================================
// Helpers
// =============================================================================

function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === "") {
    console.error(`ERROR: ${name} env var is required`);
    process.exit(1);
  }
  return value;
}

function requireAddress(name) {
  const raw = requireEnv(name);
  try {
    return ethers.getAddress(raw.trim());
  } catch (_) {
    console.error(`ERROR: ${name} is not a valid address: ${raw}`);
    process.exit(1);
  }
}

function loadDeployment(contractName, networkName, suffix) {
  const base = suffix ? `${contractName}_${suffix}` : contractName;
  const filepath = path.resolve(
    __dirname,
    `../deployments/${base}_${networkName}_latest.json`,
  );
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function saveDeployment(contractName, networkName, suffix, data) {
  const deploymentsDir = path.resolve(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const base = suffix ? `${contractName}_${suffix}` : contractName;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filepath = path.join(deploymentsDir, `${base}_${networkName}_${timestamp}.json`);
  const latestPath = path.join(deploymentsDir, `${base}_${networkName}_latest.json`);

  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(data, null, 2));
  console.log(`  Saved: ${latestPath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const apply = process.env.APPLY === "true";

  const network = await ethers.provider.getNetwork();
  const networkName = hre.network.name;
  const chainId = Number(network.chainId);

  const safeAddress = requireAddress("SAFE_ADDRESS");
  const stratoTokenAddress = requireAddress("STRATO_TOKEN_ADDRESS");
  const tokenName = requireEnv("REP_TOKEN_NAME").trim();
  const tokenSymbol = requireEnv("REP_TOKEN_SYMBOL").trim();

  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  const repBridgeDeployment = loadDeployment("StratoRepresentationBridge", networkName);
  if (!repBridgeDeployment) {
    console.error(
      `ERROR: deployments/StratoRepresentationBridge_${networkName}_latest.json not found`,
    );
    process.exit(1);
  }
  const repBridgeAddress = ethers.getAddress(repBridgeDeployment.addresses.proxy);

  console.log("=".repeat(60));
  console.log(`DEPLOY StratoRepresentationToken (${tokenSymbol})`);
  console.log("=".repeat(60));
  console.log(`Network:           ${networkName} (${chainId})`);
  console.log(`Deployer:          ${deployer.address}`);
  console.log(`Balance:           ${ethers.formatEther(balance)} ETH`);
  console.log(`Safe (admin):      ${safeAddress}`);
  console.log(`RepBridge:         ${repBridgeAddress}`);
  console.log(`STRATO token:      ${stratoTokenAddress}`);
  console.log(`Rep token name:    ${tokenName}`);
  console.log(`Rep token symbol:  ${tokenSymbol}`);
  console.log(`Apply:             ${apply}`);
  console.log();

  // Precondition: check that the rep bridge doesn't already have a mapping for this STRATO token.
  const provider = deployer.provider;
  const repBridge = new ethers.Contract(repBridgeAddress, REP_BRIDGE_ABI, provider);
  const existingMapping = await repBridge.stratoToRepresentation(stratoTokenAddress);
  if (existingMapping !== ethers.ZeroAddress) {
    console.error(
      `ERROR: StratoRepresentationBridge already maps ${stratoTokenAddress} → ${existingMapping}.`,
    );
    console.error("Refusing to deploy a duplicate. Remove the mapping first if you really mean to replace it.");
    process.exit(1);
  }

  // =========================================================================
  // Step 1: Validate that the factory compiles cleanly
  // =========================================================================

  console.log("Step 1: Loading StratoRepresentationToken factory...");
  const Factory = await ethers.getContractFactory("StratoRepresentationToken");
  console.log("  Factory loaded ✓");

  if (!apply) {
    console.log("\nDry run — no transactions submitted.");
    console.log("Planned actions (when APPLY=true):");
    console.log(`  1. Deploy UUPS proxy with initialize("${tokenName}", "${tokenSymbol}", ${safeAddress})`);
    console.log(`  2. Safe proposal: grantRole(MINTER_ROLE, ${repBridgeAddress}) on the new token`);
    console.log(`  3. Safe proposal: setTokenMapping(${stratoTokenAddress}, <new proxy>) on ${repBridgeAddress}`);

    const outputPath = writeOutput(
      `deploy-rep-token-${tokenSymbol.toLowerCase()}-${networkName}`,
      {
        status: "dry-run",
        network: networkName,
        chainId,
        safe: safeAddress,
        repBridge: repBridgeAddress,
        stratoToken: stratoTokenAddress,
        tokenName,
        tokenSymbol,
      },
    );
    console.log(`\nOutput: ${outputPath}`);
    return;
  }

  if (balance === 0n) {
    console.error("ERROR: Deployer has no ETH balance; cannot deploy.");
    process.exit(1);
  }

  // =========================================================================
  // Step 2: Deploy StratoRepresentationToken proxy
  // =========================================================================

  console.log("\nStep 2: Deploying StratoRepresentationToken proxy...");
  const proxy = await upgrades.deployProxy(
    Factory,
    [tokenName, tokenSymbol, safeAddress],
    { initializer: "initialize", kind: "uups" },
  );
  await proxy.waitForDeployment();

  const proxyAddress = await proxy.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  console.log(`  Proxy:          ${proxyAddress}`);
  console.log(`  Implementation: ${implementationAddress}`);

  saveDeployment("StratoRepresentationToken", networkName, tokenSymbol, {
    contractName: "StratoRepresentationToken",
    network: { name: networkName, chainId: chainId.toString() },
    addresses: {
      proxy: proxyAddress,
      implementation: implementationAddress,
    },
    configuration: {
      name: tokenName,
      symbol: tokenSymbol,
      admin: safeAddress,
      stratoTokenMappedOnBridge: stratoTokenAddress,
      repBridge: repBridgeAddress,
    },
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    deploymentBlock: await provider.getBlockNumber(),
  });

  // =========================================================================
  // Step 3: Propose grantRole(MINTER_ROLE, repBridge) on the new token
  // =========================================================================

  console.log("\nStep 3: Proposing grantRole(MINTER_ROLE, repBridge) via Safe...");

  const accessIface = new ethers.Interface(ACCESS_CONTROL_ABI);
  const grantData = accessIface.encodeFunctionData("grantRole", [
    MINTER_ROLE,
    repBridgeAddress,
  ]);

  let grantResult;
  try {
    grantResult = await proposeBatch(
      chainId,
      [{ to: proxyAddress, value: "0", data: grantData, operation: 0 }],
      { safeAddress },
    );
    console.log(`  safeTxHash: ${grantResult.safeTxHash}`);
    console.log(`  nonce:      ${grantResult.nonce}`);
  } catch (error) {
    console.error(`  Safe proposal FAILED: ${error.message}`);
    console.log(`\n  Manual Safe UI fallback:`);
    console.log(`    Target:  ${proxyAddress}`);
    console.log(`    Method:  grantRole(${MINTER_ROLE}, ${repBridgeAddress})`);
    console.log(`    Data:    ${grantData}`);
  }

  // =========================================================================
  // Step 4: Propose setTokenMapping(stratoToken, proxy) on the rep bridge
  // =========================================================================

  console.log("\nStep 4: Proposing setTokenMapping on StratoRepresentationBridge via Safe...");

  const repBridgeIface = new ethers.Interface(REP_BRIDGE_ABI);
  const mappingData = repBridgeIface.encodeFunctionData("setTokenMapping", [
    stratoTokenAddress,
    proxyAddress,
  ]);

  let mappingResult;
  try {
    mappingResult = await proposeBatch(
      chainId,
      [{ to: repBridgeAddress, value: "0", data: mappingData, operation: 0 }],
      { safeAddress },
    );
    console.log(`  safeTxHash: ${mappingResult.safeTxHash}`);
    console.log(`  nonce:      ${mappingResult.nonce}`);
  } catch (error) {
    console.error(`  Safe proposal FAILED: ${error.message}`);
    console.log(`\n  Manual Safe UI fallback:`);
    console.log(`    Target:  ${repBridgeAddress}`);
    console.log(`    Method:  setTokenMapping(${stratoTokenAddress}, ${proxyAddress})`);
    console.log(`    Data:    ${mappingData}`);
  }

  // =========================================================================
  // Step 5: Best-effort verification on block explorer
  // =========================================================================

  console.log("\nStep 5: Verifying implementation on block explorer...");
  try {
    await hre.run("verify:verify", {
      address: implementationAddress,
      constructorArguments: [],
    });
    console.log("  Verification successful ✓");
  } catch (e) {
    console.log(`  Verification skipped: ${e.message}`);
  }

  // =========================================================================
  // Summary + audit output
  // =========================================================================

  writeOutput(`deploy-rep-token-${tokenSymbol.toLowerCase()}-${networkName}`, {
    status: "applied",
    network: networkName,
    chainId,
    safe: safeAddress,
    repBridge: repBridgeAddress,
    stratoToken: stratoTokenAddress,
    tokenName,
    tokenSymbol,
    addresses: {
      proxy: proxyAddress,
      implementation: implementationAddress,
    },
    safeProposals: {
      grantMinterRole: grantResult
        ? { safeTxHash: grantResult.safeTxHash, nonce: grantResult.nonce }
        : { error: "failed" },
      setTokenMapping: mappingResult
        ? { safeTxHash: mappingResult.safeTxHash, nonce: mappingResult.nonce }
        : { error: "failed" },
    },
  });

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Rep token proxy:   ${proxyAddress}`);
  console.log(`Implementation:    ${implementationAddress}`);
  console.log(`Admin (Safe):      ${safeAddress}`);
  console.log(`Mapped STRATO:     ${stratoTokenAddress}`);
  console.log(`On RepBridge:      ${repBridgeAddress}`);
  console.log();
  console.log("Next steps:");
  console.log("  1. Approve the two Safe proposals in the Safe UI");
  console.log(`  2. Verify wiring: node scripts/verifyBridgeConfig.js --network ${networkName}`);
  console.log(
    `  3. (Optional) Set mint/burn rate limits via StratoRepresentationBridge.setMintRateLimit / setBurnRateLimit`,
  );
}

main().catch((error) => {
  console.error("\ndeployStratoRepresentationToken failed:", error.message || error);
  process.exit(1);
});
