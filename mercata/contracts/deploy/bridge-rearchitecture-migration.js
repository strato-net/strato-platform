/**
 * MercataBridge rearchitecture migration.
 *
 * Steps (dry-run by default, use --apply to execute):
 *
 * 1. setStratoCustodyVault - point MercataBridge to the new StratoCustodyVault
 * 2. Update existing external-canonical assets with isNative=false
 * 3. Update existing STRATO-canonical assets with isNative=true
 *
 * Prerequisites:
 *   - StratoCustodyVault must be deployed on STRATO
 *   - MercataBridge must be upgraded with isNative support
 *
 * Usage:
 *   node deploy/bridge-rearchitecture-migration.js
 *   node deploy/bridge-rearchitecture-migration.js --apply
 */
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const { callListAndWait } = require("./util");
const config = require("./config");

const DEFAULT_BRIDGE_ADDRESS = "0000000000000000000000000000000000001008";

// StratoCustodyVault address on STRATO (set after deployment)
const STRATO_CUSTODY_VAULT =
  process.env.STRATO_CUSTODY_VAULT_ADDRESS || "";

// =============================================================================
// Asset Definitions
// =============================================================================

// External-canonical assets (isNative=false) — these already exist, we re-register with isNative=false
const EXTERNAL_CANONICAL_ASSETS = [
  // USDC - Sepolia
  // Add entries here matching your existing setAsset registrations.
  // The script will call setAsset with isNative=false for each.
  // Example:
  // { externalToken: "...", externalChainId: 11155111, externalDecimals: 6,
  //   externalName: "USDC", externalSymbol: "USDC", stratoToken: "...", maxPerWithdrawal: "..." },
];

// STRATO-canonical assets (isNative=true)
const STRATO_CANONICAL_ASSETS = [
  // USDST - Sepolia
  {
    externalToken: "9346b32810297602452ff56993aba607b3455c03",
    externalChainId: 11155111,
    externalDecimals: 18,
    externalName: "USDST",
    externalSymbol: "USDST",
    stratoToken: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  },
  // USDST - Base Sepolia
  {
    externalToken: "168eca999daed6daacd63b3ac508ac2787046e66",
    externalChainId: 84532,
    externalDecimals: 18,
    externalName: "USDST",
    externalSymbol: "USDST",
    stratoToken: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
  },
  // GOLDST - Sepolia
  {
    externalToken: "c787432d66244748bcbb194532ec7c6f7d38f464",
    externalChainId: 11155111,
    externalDecimals: 18,
    externalName: "GOLDST",
    externalSymbol: "GOLDST",
    stratoToken: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
  },
  // GOLDST - Base Sepolia
  {
    externalToken: "a98de911af63a74298ae9c93a9b59eb154df0286",
    externalChainId: 84532,
    externalDecimals: 18,
    externalName: "GOLDST",
    externalSymbol: "GOLDST",
    stratoToken: "cdc93d30182125e05eec985b631c7c61b3f63ff0",
  },
  // SILVST - Sepolia
  {
    externalToken: "f9acfad7cdef726f47976eb2b96e19e2b5a122fe",
    externalChainId: 11155111,
    externalDecimals: 18,
    externalName: "SILVST",
    externalSymbol: "SILVST",
    stratoToken: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
  },
  // SILVST - Base Sepolia
  {
    externalToken: "d99d313205f4e944dbf66e169f72c18aa88c54ee",
    externalChainId: 84532,
    externalDecimals: 18,
    externalName: "SILVST",
    externalSymbol: "SILVST",
    stratoToken: "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94",
  },
];

const ZERO_UINT256 = "0000000000000000000000000000000000000000";

// =============================================================================
// Helpers
// =============================================================================

function parseArgs() {
  const parsed = { apply: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--apply") parsed.apply = true;
  }
  return parsed;
}

function buildSetStratoCustodyVaultCall(bridgeAddress, vaultAddress) {
  return {
    contract: { address: bridgeAddress, name: "MercataBridge" },
    method: "setStratoCustodyVault",
    args: { newVault: vaultAddress },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
}

function buildSetAssetCall(bridgeAddress, asset, isNative) {
  return {
    contract: { address: bridgeAddress, name: "MercataBridge" },
    method: "setAsset",
    args: {
      enabled: true,
      isNative,
      externalChainId: asset.externalChainId,
      externalDecimals: asset.externalDecimals,
      externalName: asset.externalName,
      externalSymbol: asset.externalSymbol,
      externalToken: asset.externalToken,
      maxPerWithdrawal: asset.maxPerWithdrawal || ZERO_UINT256,
      stratoToken: asset.stratoToken,
    },
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = parseArgs();
  const bridgeAddress = DEFAULT_BRIDGE_ADDRESS;
  const apply = !!args.apply;

  const plannedCalls = [];

  // Step 1: Set StratoCustodyVault
  if (STRATO_CUSTODY_VAULT) {
    plannedCalls.push(
      buildSetStratoCustodyVaultCall(bridgeAddress, STRATO_CUSTODY_VAULT),
    );
  } else {
    console.warn("WARNING: STRATO_CUSTODY_VAULT_ADDRESS not set. Skipping setStratoCustodyVault.");
  }

  // Step 2: Re-register external-canonical assets with isNative=false
  for (const asset of EXTERNAL_CANONICAL_ASSETS) {
    plannedCalls.push(buildSetAssetCall(bridgeAddress, asset, false));
  }

  // Step 3: Register/update STRATO-canonical assets with isNative=true
  for (const asset of STRATO_CANONICAL_ASSETS) {
    plannedCalls.push(buildSetAssetCall(bridgeAddress, asset, true));
  }

  console.log("=== MercataBridge Rearchitecture Migration ===");
  console.log(
    JSON.stringify(
      {
        nodeUrl: config.nodes?.[0]?.url || null,
        bridgeAddress,
        stratoCustodyVault: STRATO_CUSTODY_VAULT || "(not set)",
        apply,
        externalCanonicalCount: EXTERNAL_CANONICAL_ASSETS.length,
        stratoCanonicalCount: STRATO_CANONICAL_ASSETS.length,
        totalCalls: plannedCalls.length,
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to execute.");
    console.log("Planned calls:");
    console.log(JSON.stringify(plannedCalls, null, 2));
    return;
  }

  const results = await callListAndWait(plannedCalls);
  console.log("\nExecution results:");
  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("bridge-rearchitecture-migration failed:", error.message);
    process.exit(1);
  });
}

module.exports = { main };
