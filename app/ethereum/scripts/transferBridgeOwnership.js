/**
 * Hand the outbound bridge stack off the deploy key to a permanent owner.
 *
 * ORDER MATTERS. BridgeVault.setAdminMultisig is onlyOwner, so it must run
 * BEFORE that contract's transferOwnership -- afterwards the deploy key can no
 * longer set it, and the admin role would be stranded on a discarded key.
 *
 * OwnableUpgradeable is single-step: there is no acceptOwnership, so a wrong
 * NEW_OWNER is unrecoverable and takes the UUPS upgrade rights with it. The
 * script refuses to run against an address with no code and no balance.
 *
 *   NEW_OWNER=0x... npx hardhat run scripts/transferBridgeOwnership.js --network sepolia
 */
const { ethers } = require("hardhat");

const CONTRACTS = {
  STRATOLightClient: "0x73a7d49DbC12cde79c606cabfb79F4abEc8bA05b",
  BridgeVault: "0x3C78b38255C6a373066cD7148a13E6b1c82d4C71",
  DepositRouter: "0x4c64FAEf5490cEe3c9fe518Cc08267aa7B6c70dc",
};
const OWNABLE = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)",
];
const VAULT_ADMIN = [
  "function adminMultisig() view returns (address)",
  "function setAdminMultisig(address newAdmin)",
];

async function main() {
  const newOwner = process.env.NEW_OWNER;
  if (!newOwner || !ethers.isAddress(newOwner)) throw new Error("NEW_OWNER must be a valid address");
  const target = ethers.getAddress(newOwner);

  const [signer] = await ethers.getSigners();
  const provider = ethers.provider;

  // Guard against handing control to a typo.
  const code = await provider.getCode(target);
  const bal = await provider.getBalance(target);
  if (code === "0x" && bal === 0n) {
    throw new Error(`${target} has no code and no balance -- refusing to transfer to a likely typo`);
  }
  console.log(`New owner: ${target} (${code === "0x" ? "EOA" : "contract"})`);
  console.log(`Signer   : ${signer.address}\n`);

  // 1. Admin role first, while we still own the vault.
  const vault = new ethers.Contract(CONTRACTS.BridgeVault, VAULT_ADMIN, signer);
  const curAdmin = await vault.adminMultisig();
  if (curAdmin.toLowerCase() === target.toLowerCase()) {
    console.log("BridgeVault.adminMultisig already correct");
  } else {
    console.log(`BridgeVault.setAdminMultisig ${curAdmin} -> ${target}`);
    await (await vault.setAdminMultisig(target)).wait(1);
    const now = await vault.adminMultisig();
    if (now.toLowerCase() !== target.toLowerCase()) throw new Error(`adminMultisig is ${now}`);
    console.log("  ok");
  }

  // 2. Then ownership.
  for (const [name, addr] of Object.entries(CONTRACTS)) {
    const c = new ethers.Contract(addr, OWNABLE, signer);
    const cur = await c.owner();
    if (cur.toLowerCase() === target.toLowerCase()) {
      console.log(`${name}: already owned by target`);
      continue;
    }
    if (cur.toLowerCase() !== signer.address.toLowerCase()) {
      throw new Error(`${name} is owned by ${cur}, not the signer -- cannot transfer`);
    }
    console.log(`${name}: transferOwnership -> ${target}`);
    await (await c.transferOwnership(target)).wait(1);
    const after = await c.owner();
    if (after.toLowerCase() !== target.toLowerCase()) throw new Error(`${name} owner is ${after}`);
    console.log("  ok");
  }

  console.log("\nFinal state:");
  for (const [name, addr] of Object.entries(CONTRACTS)) {
    const c = new ethers.Contract(addr, OWNABLE, provider);
    console.log(`  ${name.padEnd(18)} owner=${await c.owner()}`);
  }
  const v = new ethers.Contract(CONTRACTS.BridgeVault, VAULT_ADMIN, provider);
  console.log(`  BridgeVault.adminMultisig = ${await v.adminMultisig()}`);
}

main().catch((e) => { console.error("FAILED:", e.message || e); process.exit(1); });
