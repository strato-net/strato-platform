/**
 * Record already-deployed native bridge proxies in the OpenZeppelin manifest
 * (.openzeppelin/<network>.json) so future upgrades get storage-layout checks.
 *
 * Only run this when the local contract source matches what is deployed. For
 * Ethereum mainnet that was confirmed on 2026-09-14: every implementation is a
 * Sourcify exact match and its verified source hashes equal the files in
 * contracts/bridge/.
 *
 * Usage:
 *   REPRESENTATION_BRIDGE_PROXY=0x... \
 *   REPRESENTATION_TOKEN_PROXIES=0x...,0x... \
 *   npx hardhat run scripts/importNativeBridgeManifest.js --network mainnet
 */
const { ethers, upgrades, network } = require("hardhat");

const parseAddresses = (value) =>
  (value || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address) => {
      if (!ethers.isAddress(address)) throw new Error(`Invalid address: ${address}`);
      return ethers.getAddress(address);
    });

async function importProxy(label, proxyAddress, factory) {
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  try {
    await upgrades.forceImport(proxyAddress, factory, { kind: "uups" });
    console.log(`imported  ${label} proxy ${proxyAddress} (implementation ${implementation})`);
  } catch (error) {
    if (/already|registered/i.test(error.message)) {
      console.log(`present   ${label} proxy ${proxyAddress} (implementation ${implementation})`);
    } else {
      throw error;
    }
  }
  // Upgrading to the same source must pass; this proves the recorded layout is usable.
  await upgrades.validateUpgrade(proxyAddress, factory, { kind: "uups" });
}

async function main() {
  const bridgeProxies = parseAddresses(process.env.REPRESENTATION_BRIDGE_PROXY);
  const tokenProxies = parseAddresses(process.env.REPRESENTATION_TOKEN_PROXIES);
  if (bridgeProxies.length === 0 && tokenProxies.length === 0) {
    throw new Error("Set REPRESENTATION_BRIDGE_PROXY and/or REPRESENTATION_TOKEN_PROXIES");
  }

  console.log(`network ${network.name} (chainId ${network.config.chainId ?? "from RPC"})`);
  const bridgeFactory = await ethers.getContractFactory("StratoNativeRepresentationBridge");
  const tokenFactory = await ethers.getContractFactory("StratoNativeRepresentationToken");

  for (const proxy of bridgeProxies) await importProxy("bridge", proxy, bridgeFactory);
  for (const proxy of tokenProxies) await importProxy("token ", proxy, tokenFactory);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
