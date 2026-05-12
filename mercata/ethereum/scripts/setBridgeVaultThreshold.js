/**
 * Adjust the per-token `instantThreshold` on a deployed BridgeVault.
 *
 * BridgeVault.setInstantThreshold(token, newThreshold) is `onlyOwner`,
 * so this must run with the same key that originally deployed the
 * vault (PRIVATE_KEY in env). The owner is independent of the
 * `adminMultisig` role, which gates the rejectWithdrawal / per-claim
 * approval flow.
 *
 * --------------------------------------------------------------------------
 * Required env vars:
 *   VAULT_ADDR            BridgeVault proxy address (0x-prefixed).
 *   NEW_THRESHOLD         New threshold for `TOKEN`. Accepts either a decimal
 *                         token amount ("0.1") OR a raw wei/smallest-unit
 *                         integer ("100000000000000000"). The interpretation
 *                         depends on whether the value contains a "." —
 *                         decimals get parsed via ethers.parseUnits using
 *                         the token's declared decimals (18 for ETH).
 *
 * Optional env vars:
 *   TOKEN                 ERC-20 address whose threshold to update.
 *                         Defaults to 0x0...0 (native ETH).
 *   DECIMALS              Decimals to use when parsing a fractional
 *                         NEW_THRESHOLD. Defaults to 18.
 *   PRIVATE_KEY           Owner key. Loaded from .env if unset.
 * --------------------------------------------------------------------------
 *
 * Usage (Linea mainnet):
 *   VAULT_ADDR=0xVault... NEW_THRESHOLD=0.5 \
 *     npx hardhat run scripts/setBridgeVaultThreshold.js --network linea
 *
 * The script prints before/after thresholds and the tx hash. No state
 * change happens until the tx confirms.
 */

const { ethers } = require("hardhat");

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v.trim();
}

function parseThreshold(raw, decimals) {
  // Decimal form ("0.5", "1.25") → parseUnits at `decimals` precision.
  // Pure integer form ("500000000000000000") → BigInt as-is.
  if (raw.includes(".")) return ethers.parseUnits(raw, decimals);
  return BigInt(raw);
}

async function main() {
  const vaultAddr = ethers.getAddress(requireEnv("VAULT_ADDR"));
  const token = ethers.getAddress(process.env.TOKEN || "0x0000000000000000000000000000000000000000");
  const decimals = Number(process.env.DECIMALS || 18);
  const newThreshold = parseThreshold(requireEnv("NEW_THRESHOLD"), decimals);

  const [signer] = await ethers.getSigners();
  console.log("=".repeat(72));
  console.log("BridgeVault.setInstantThreshold");
  console.log("=".repeat(72));
  console.log(`Network         : ${(await ethers.provider.getNetwork()).chainId}`);
  console.log(`Vault           : ${vaultAddr}`);
  console.log(`Token           : ${token}${token === ethers.ZeroAddress ? "  (native ETH)" : ""}`);
  console.log(`Signer (owner?) : ${signer.address}`);
  console.log(`New threshold   : ${newThreshold} (${ethers.formatUnits(newThreshold, decimals)} @ ${decimals} decimals)`);

  const vault = await ethers.getContractAt("BridgeVault", vaultAddr, signer);

  // Sanity: confirm the signer is the owner. setInstantThreshold reverts
  // with OwnableUnauthorizedAccount otherwise, but checking up-front gives
  // a friendlier error.
  const owner = await vault.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not the vault owner (owner is ${owner}). ` +
      `setInstantThreshold is onlyOwner — point PRIVATE_KEY at the right key.`,
    );
  }

  const current = await vault.instantThreshold(token);
  console.log(`Current threshold: ${current} (${ethers.formatUnits(current, decimals)})`);

  if (current === newThreshold) {
    console.log("No change required — threshold already matches. Exiting.");
    return;
  }

  console.log("\nSubmitting tx...");
  const tx = await vault.setInstantThreshold(token, newThreshold);
  console.log(`  hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  mined in block ${receipt.blockNumber}, gas used ${receipt.gasUsed}`);

  const updated = await vault.instantThreshold(token);
  console.log(`Updated threshold: ${updated} (${ethers.formatUnits(updated, decimals)})`);
  if (updated !== newThreshold) {
    throw new Error("post-tx threshold doesn't match what we sent — investigate");
  }
  console.log("\n✓ Done.");
}

main().catch((err) => {
  console.error("setBridgeVaultThreshold failed:", err.message || err);
  process.exit(1);
});
