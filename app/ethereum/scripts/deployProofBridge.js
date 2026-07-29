/**
 * Deploys the full bridge stack on the configured external chain:
 * STRATOLightClient + BridgeVault (OUT direction) + DepositRouter
 * (IN direction). The DepositRouter's `gnosisSafe` is wired to the
 * BridgeVault, so deposits and withdrawals share custody.
 *
 * Fetches the STRATO validator set + a starting tip block from the running
 * STRATO node (via strato_getReceiptProof), so the freshly-deployed light
 * client matches the live network's validator set without manual entry.
 *
 * --------------------------------------------------------------------------
 * Required env vars:
 *   STRATO_RPC_URL        e.g. http://localhost:3000/eth/jsonrpc/v1.2
 *   STRATO_BRIDGE_ADDR    MercataBridge address on STRATO (40-hex, with/without 0x)
 *   GENESIS_BLOCK         Block number to seed the light client at. The first
 *                         submitted header must satisfy number > GENESIS_BLOCK.
 *                         Pick a block that's already finalized AND has a
 *                         receipt proof available -- the script verifies this
 *                         by calling strato_getReceiptProof at that block.
 *
 * Optional env vars:
 *   ADMIN_MULTISIG        Defaults to deployer (warns).
 *   ETH_THRESHOLD_WEI     Per-claim instant-release threshold for ETH. Defaults
 *                         to 0.05 ETH (5e16 wei). Above this, withdrawals
 *                         require admin approval via submitProof.
 *   FUND_ETH              Amount of ETH to send to the vault as withdrawal
 *                         liquidity (e.g. "0.1"). Skipped if unset/zero.
 *   GENESIS_TX_INDEX      Tx index to use when probing strato_getReceiptProof
 *                         for validator extraction. Defaults to 0.
 *   PERMIT2_ADDRESS       Permit2 contract address. Defaults to the canonical
 *                         deployment 0x000000000022D473030F116dDEE9F6B43aC78BA3
 *                         which exists on every major EVM chain (Sepolia,
 *                         Base Sepolia, mainnet, Base, etc.).
 * --------------------------------------------------------------------------
 *
 * Usage:
 *   STRATO_RPC_URL=http://localhost:3000/eth/jsonrpc/v1.2 \
 *   STRATO_BRIDGE_ADDR=0xMercataBridge... \
 *   GENESIS_BLOCK=42 \
 *   FUND_ETH=0.1 \
 *   npx hardhat run scripts/deployProofBridge.js --network sepolia
 */

const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v.trim();
}

function ensureHex(addr) {
  const a = addr.startsWith("0x") ? addr : `0x${addr}`;
  return ethers.getAddress(a);
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.error) throw new Error(`RPC ${method} error: ${body.error.message}`);
  return body.result;
}

/**
 * Pull the V2 header for `genesisBlock` from STRATO and decode `currentValidators`
 * (field index 9). We use strato_getReceiptProof because it returns the canonical
 * header bytes; if that block has no receipts at txIndex 0, the user can override
 * via GENESIS_TX_INDEX.
 */
async function fetchValidatorsAtBlock(rpcUrl, genesisBlock, txIndex) {
  const result = await rpcCall(rpcUrl, "strato_getReceiptProof", [
    String(genesisBlock),
    txIndex,
  ]);
  if (!result || !result.headerRLP) {
    throw new Error(
      `strato_getReceiptProof returned no header for block ${genesisBlock} txIndex ${txIndex}. ` +
        `Try a different block number or set GENESIS_TX_INDEX.`,
    );
  }
  const fields = ethers.decodeRlp(result.headerRLP);
  if (fields.length !== 14) {
    throw new Error(
      `Expected 14-field V2 header, got ${fields.length}. Is the block pre-fork?`,
    );
  }
  const validators = fields[9];
  if (!Array.isArray(validators) || validators.length === 0) {
    throw new Error("currentValidators field is empty or not a list");
  }
  return validators.map(ethers.getAddress);
}

async function saveDeployment(network, addresses, config) {
  const dir = path.resolve("deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const payload = {
    network: { name: network.name, chainId: network.chainId.toString() },
    addresses,
    config,
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dir, `ProofBridge_${network.name}_${ts}.json`),
    JSON.stringify(payload, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, `ProofBridge_${network.name}_latest.json`),
    JSON.stringify(payload, null, 2),
  );
}

async function main() {
  const stratoRpcUrl = requireEnv("STRATO_RPC_URL");
  const stratoBridgeAddr = ensureHex(requireEnv("STRATO_BRIDGE_ADDR"));
  const genesisBlock = parseInt(requireEnv("GENESIS_BLOCK"), 10);
  if (!Number.isFinite(genesisBlock) || genesisBlock <= 0) {
    throw new Error(`GENESIS_BLOCK must be a positive integer, got ${process.env.GENESIS_BLOCK}`);
  }
  const genesisTxIndex = parseInt(process.env.GENESIS_TX_INDEX || "0", 10);
  const ethThresholdWei = process.env.ETH_THRESHOLD_WEI
    ? BigInt(process.env.ETH_THRESHOLD_WEI)
    : 50_000_000_000_000_000n; // 0.05 ETH default
  const fundEthString = process.env.FUND_ETH || "0";
  const fundEthWei = ethers.parseEther(fundEthString);
  // Permit2 — canonical deployment lives at the same address on every
  // major EVM (Sepolia, Base Sepolia, mainnet, Base, Arbitrum, etc.).
  // Override only if you're on a chain where it's deployed elsewhere.
  const permit2Addr = ensureHex(
    process.env.PERMIT2_ADDRESS || "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  );

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const adminMultisig = process.env.ADMIN_MULTISIG
    ? ensureHex(process.env.ADMIN_MULTISIG)
    : deployer.address;

  console.log("=".repeat(64));
  console.log("PROOF-BRIDGE DEPLOYMENT");
  console.log("=".repeat(64));
  console.log(`Network            : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer           : ${deployer.address}`);
  console.log(`Deployer balance   : ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`);
  console.log(`STRATO RPC         : ${stratoRpcUrl}`);
  console.log(`STRATO bridge addr : ${stratoBridgeAddr}`);
  console.log(`Genesis block      : ${genesisBlock} (txIndex ${genesisTxIndex})`);
  console.log(`Admin multisig     : ${adminMultisig}${adminMultisig === deployer.address ? "  (WARNING: deployer; pass ADMIN_MULTISIG for real deploys)" : ""}`);
  console.log(`ETH threshold      : ${ethThresholdWei} wei (${ethers.formatEther(ethThresholdWei)} ETH)`);
  console.log(`Vault funding      : ${fundEthString} ETH`);
  console.log(`Permit2            : ${permit2Addr}`);

  // ---- Step 1: pull validators from STRATO ----
  console.log("\n[1/5] Fetching validator set from STRATO...");
  const validators = await fetchValidatorsAtBlock(stratoRpcUrl, genesisBlock, genesisTxIndex);
  // STRATOLightClient.initialize requires strictly ascending order.
  const sortedValidators = [...validators]
    .map((a) => a.toLowerCase())
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
    .map(ethers.getAddress);
  console.log(`  Validators (${sortedValidators.length}):`);
  for (const v of sortedValidators) console.log(`    ${v}`);

  // ---- Step 2: deploy STRATOLightClient ----
  console.log("\n[2/5] Deploying STRATOLightClient...");
  const LC = await ethers.getContractFactory("STRATOLightClient");
  const lc = await upgrades.deployProxy(
    LC,
    [deployer.address, genesisBlock, sortedValidators],
    { kind: "uups" },
  );
  await lc.waitForDeployment();
  const lightClientAddr = await lc.getAddress();
  console.log(`  STRATOLightClient: ${lightClientAddr}`);

  // ---- Step 3: deploy BridgeVault ----
  console.log("\n[3/5] Deploying BridgeVault...");
  const Vault = await ethers.getContractFactory("BridgeVault");
  const vault = await upgrades.deployProxy(
    Vault,
    [
      deployer.address,
      adminMultisig,
      lightClientAddr,
      stratoBridgeAddr,
      Number(network.chainId),
    ],
    { kind: "uups" },
  );
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`  BridgeVault     : ${vaultAddr}`);

  // ---- Step 4: deploy DepositRouter, gnosisSafe = BridgeVault ----
  // The router forwards inbound deposits to its `gnosisSafe`, which we
  // wire to the BridgeVault so deposits and withdrawals share custody:
  // outbound funds are released from the vault on a verified STRATO
  // proof, inbound funds accumulate into the same address (and the
  // vault is what the trustless EthBridgeIn flow on STRATO proves
  // against via the receipts trie).
  console.log("\n[4/5] Deploying DepositRouter...");
  const Router = await ethers.getContractFactory("DepositRouter");
  const router = await upgrades.deployProxy(
    Router,
    [permit2Addr, vaultAddr, deployer.address],
    { kind: "uups" },
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log(`  DepositRouter   : ${routerAddr}`);
  console.log(`  → gnosisSafe wired to BridgeVault (${vaultAddr})`);

  // ---- Step 5: configure ETH threshold + fund ----
  console.log("\n[5/5] Configuring vault...");
  const ETH_TOKEN = "0x0000000000000000000000000000000000000000";
  const setThresh = await vault.setInstantThreshold(ETH_TOKEN, ethThresholdWei);
  await setThresh.wait();
  console.log(`  ETH instantThreshold set to ${ethers.formatEther(ethThresholdWei)} ETH`);

  if (fundEthWei > 0n) {
    const fund = await deployer.sendTransaction({
      to: vaultAddr,
      value: fundEthWei,
    });
    await fund.wait();
    const balance = await ethers.provider.getBalance(vaultAddr);
    console.log(`  Funded vault with ${fundEthString} ETH (balance now ${ethers.formatEther(balance)})`);
  }

  await saveDeployment(network, {
    stratoLightClient: lightClientAddr,
    bridgeVault: vaultAddr,
    depositRouter: routerAddr,
  }, {
    stratoBridgeAddr,
    genesisBlock,
    sortedValidators,
    ethThresholdWei: ethThresholdWei.toString(),
    fundEthWei: fundEthWei.toString(),
    adminMultisig,
    permit2Addr,
  });

  console.log("\n" + "=".repeat(64));
  console.log("DONE");
  console.log("=".repeat(64));
  console.log(`bridgeVault       : ${vaultAddr}`);
  console.log(`stratoLightClient : ${lightClientAddr}`);
  console.log(`depositRouter     : ${routerAddr}`);
  console.log("\nNext, on STRATO call MercataBridge.setChain with the same chainId:");
  console.log(`  setChain(<chainName>, <custody>, <hotWallet>, true, ${network.chainId}, <lastProcessedBlock>, ${routerAddr}, ${vaultAddr}, ${lightClientAddr})`);
  console.log("\nThen run deployTrustlessBridge.js (mercata/contracts) to wire the IN-direction");
  console.log("EthBridgeIn that points at this DepositRouter:");
  console.log(`  npm run bridge:trustless:deploy:testnet -- \\`);
  console.log(`    --${network.name === "sepolia" ? "sepolia" : "base-sepolia"}-deposit-router ${routerAddr} \\`);
  console.log(`    --apply`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
