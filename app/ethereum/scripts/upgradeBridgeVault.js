/**
 * Upgrade a deployed BridgeVault in place (UUPS).
 *
 * Used for the change that removed order-gated release. The sequencing storage
 * (`queuedClaims`, `nextSeqToProcess`) is deliberately retained in the new
 * implementation so the layout is unchanged -- the upgrades plugin validates
 * that, and it is the reason those variables are still declared.
 *
 *   VAULT_ADDRESS=0x... npx hardhat run scripts/upgradeBridgeVault.js --network sepolia
 */
const { ethers, upgrades } = require("hardhat");

async function main() {
  const addr = process.env.VAULT_ADDRESS;
  if (!addr) throw new Error("VAULT_ADDRESS is required");

  const [signer] = await ethers.getSigners();
  console.log(`Upgrading BridgeVault ${addr}`);
  console.log(`  signer: ${signer.address}`);

  const vault = await ethers.getContractAt("BridgeVault", addr);
  const owner = await vault.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`signer is not the owner (_authorizeUpgrade is onlyOwner); owner is ${owner}`);
  }

  const before = {
    nextSeq: (await vault.nextSeqToProcess()).toString(),
    balance: (await ethers.provider.getBalance(addr)).toString(),
  };

  const implBefore = await upgrades.erc1967.getImplementationAddress(addr);
  console.log(`  implementation before: ${implBefore}`);

  const Vault = await ethers.getContractFactory("BridgeVault");
  const upgraded = await upgrades.upgradeProxy(addr, Vault);
  await upgraded.waitForDeployment();

  // Re-read until the ERC1967 slot actually moves. Reading once right after
  // upgradeProxy can race the upgrade tx and return the OLD implementation,
  // which makes the script cheerfully report the wrong address.
  let implAddr = implBefore;
  for (let i = 0; i < 20 && implAddr === implBefore; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    implAddr = await upgrades.erc1967.getImplementationAddress(addr);
  }
  if (implAddr === implBefore) {
    throw new Error(`implementation slot never changed from ${implBefore}`);
  }
  console.log(`  implementation after : ${implAddr}`);

  const after = {
    nextSeq: (await upgraded.nextSeqToProcess()).toString(),
    balance: (await ethers.provider.getBalance(addr)).toString(),
  };
  console.log(`  nextSeqToProcess: ${before.nextSeq} -> ${after.nextSeq}`);
  console.log(`  vault balance   : ${ethers.formatEther(before.balance)} -> ${ethers.formatEther(after.balance)} ETH`);
  if (before.balance !== after.balance) throw new Error("vault balance changed during upgrade");
  console.log("DONE");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
