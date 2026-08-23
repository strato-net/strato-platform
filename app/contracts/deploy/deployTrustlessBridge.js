/**
 * One-shot deployer for the trustless bridge-in stack on STRATO.
 *
 * Deploys + wires:
 *   1. EthLightClient                 (one global; wraps L1 = Sepolia/mainnet)
 *   2. EthLightClient.bootstrap(...)  (live committee fetched from beacon API)
 *   3. EthBridgeIn (Eth-flavor)       (srcChainId = 11155111 / 1)
 *   4. BaseLightClient                (wraps EthLightClient + Base DGF)
 *   5. EthBridgeIn (Base-flavor)      (srcChainId = 84532 / 8453)
 *   6. setMintTarget(MercataBridge)   on each EthBridgeIn
 *   7. MercataBridge.setBridgeIn(chainId, addr)  for each
 *
 * Usage:
 *   node deploy/deployTrustlessBridge.js \
 *     --env testnet \
 *     --sepolia-deposit-router 0xSEPDEPROUTER \
 *     --base-sepolia-deposit-router 0xBASDEPROUTER \
 *     --apply
 *
 * Defaults to a dry-run (--apply executes). All STRATO writes go
 * through the GLOBAL_ADMIN credentials in env.
 *
 * Required env:
 *   GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD     (STRATO admin auth)
 *   NODE_URL                                       (STRATO node URL)
 *   OAUTH_URL / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
 *
 * Optional env:
 *   BEACON_URL_SEPOLIA   (default: https://lodestar-sepolia.chainsafe.io)
 *   BEACON_URL_MAINNET   (required for prod)
 *   MERCATA_BRIDGE_ADDR  (default: 0000000000000000000000000000000000001008)
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const axios = require("axios");
const { rest, util, importer } = require("blockapps-rest");
const config = require("./config");
const auth = require("./auth");
const { callListAndWait } = require("./util");

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_MERCATA_BRIDGE = "0000000000000000000000000000000000001008";

const PROFILES = {
  testnet: {
    l1ChainId: 11155111,
    l2ChainId: 84532,                                                      // Base Sepolia
    l2DisputeGameFactory: "0xd6E6dBf4F7EA0ac412fD8b65ED297e64BB7a06E1",
    beaconUrl: process.env.BEACON_URL_SEPOLIA || "https://lodestar-sepolia.chainsafe.io",
  },
  prod: {
    l1ChainId: 1,
    l2ChainId: 8453,                                                       // Base mainnet
    l2DisputeGameFactory: "0x43edB88C4B80fDD2AdFF2412A7BebF9dF42cB40e",
    beaconUrl: process.env.BEACON_URL_MAINNET,
  },
};

/// keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
const DEPOSIT_ROUTED_SIG =
  "0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750";

/// keccak256("DisputeGameCreated(address,uint32,bytes32)")
const DISPUTE_GAME_CREATED_SIG =
  "0x5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35";

const SLOTS_PER_EPOCH = 32;
const EPOCHS_PER_SYNC_COMMITTEE_PERIOD = 256;

// ─────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { apply: false, env: "testnet" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") { out.apply = true; continue; }
    if (a === "--env") { out.env = argv[++i]; continue; }
    if (a === "--sepolia-deposit-router") { out.sepoliaDepositRouter = argv[++i]; continue; }
    if (a === "--base-sepolia-deposit-router") { out.baseSepoliaDepositRouter = argv[++i]; continue; }
    if (a === "--mainnet-deposit-router") { out.mainnetDepositRouter = argv[++i]; continue; }
    if (a === "--base-deposit-router") { out.baseDepositRouter = argv[++i]; continue; }
    if (a === "--bridge-addr") { out.bridgeAddr = argv[++i]; continue; }
    throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function ensureHex(addr) {
  if (!addr) throw new Error("missing address");
  return addr.startsWith("0x") ? addr.toLowerCase() : `0x${addr.toLowerCase()}`;
}
function strip0x(s) {
  return s.startsWith("0x") ? s.slice(2) : s;
}

// ─────────────────────────────────────────────────────────────────────
// Beacon API: fetch live sync committee for bootstrap
// ─────────────────────────────────────────────────────────────────────

async function fetchBootstrapInputs(beaconUrl) {
  if (!beaconUrl) {
    throw new Error("beacon URL not configured (set BEACON_URL_MAINNET / SEPOLIA)");
  }
  const base = beaconUrl.replace(/\/$/, "");

  // 1. Finalized header → root
  const headerResp = await axios.get(`${base}/eth/v1/beacon/headers/finalized`);
  const headerData = headerResp.data?.data;
  if (!headerData) throw new Error("beacon: empty finalized-header response");
  const finalizedRoot = headerData.root;
  const finalizedSlot = parseInt(headerData.header.message.slot, 10);

  // 2. Bootstrap at that root
  const bootstrapResp = await axios.get(
    `${base}/eth/v1/beacon/light_client/bootstrap/${finalizedRoot}`,
  );
  const bootstrap = bootstrapResp.data?.data;
  if (!bootstrap) throw new Error(`beacon: empty bootstrap for root ${finalizedRoot}`);
  const pubkeys = bootstrap.current_sync_committee?.pubkeys;
  if (!Array.isArray(pubkeys) || pubkeys.length !== 512) {
    throw new Error(`beacon: expected 512 sync-committee pubkeys, got ${pubkeys?.length}`);
  }

  // 3. Fork schedule → fork version active at this slot
  const forkResp = await axios.get(`${base}/eth/v1/config/fork_schedule`);
  const forks = forkResp.data?.data || [];
  const epoch = Math.floor(finalizedSlot / SLOTS_PER_EPOCH);
  // Forks are returned ordered by epoch; pick the latest one whose
  // epoch <= our slot's epoch.
  const active = forks
    .map((f) => ({ epoch: parseInt(f.epoch, 10), version: f.current_version }))
    .filter((f) => f.epoch <= epoch)
    .sort((a, b) => b.epoch - a.epoch)[0];
  if (!active) throw new Error("beacon: no active fork at finalized slot");

  // 4. Genesis validators root (well-known per network; pull via spec)
  const specResp = await axios.get(`${base}/eth/v1/beacon/genesis`);
  const genesisValidatorsRoot = specResp.data?.data?.genesis_validators_root;
  if (!genesisValidatorsRoot) throw new Error("beacon: missing genesis_validators_root");

  const period = Math.floor(finalizedSlot / (SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD));

  return {
    period,
    pubkeys,                         // 512 × "0x" + 96-hex (compressed G1, 48 bytes)
    genesisValidatorsRoot,
    forkVersion: active.version,
    finalizedSlot,
    finalizedRoot,
  };
}

// ─────────────────────────────────────────────────────────────────────
// STRATO contract ops
// ─────────────────────────────────────────────────────────────────────

async function getAdminToken() {
  const u = process.env.GLOBAL_ADMIN_NAME;
  const p = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!u || !p) {
    throw new Error("GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD required");
  }
  const tokenString = await auth.getUserToken(u, p);
  if (!tokenString) throw new Error("auth.getUserToken returned empty");
  const tokenObj = { token: tokenString };

  // Resolve the admin's STRATO address — needed as the Ownable
  // initialOwner for every contract we deploy. Without it, Ownable's
  // ctor reverts with OwnableInvalidOwner(0x000...). Allow an env-var
  // override to skip the lookup (useful when the admin's STRATO key
  // hasn't been registered yet, since rest.getKey would 404).
  if (process.env.GLOBAL_ADMIN_ADDRESS) {
    tokenObj.userAddress = ensureHex(process.env.GLOBAL_ADMIN_ADDRESS);
  } else {
    try {
      const addr = await rest.getKey(tokenObj, { config });
      if (!addr) throw new Error("rest.getKey returned empty");
      tokenObj.userAddress = ensureHex(addr);
    } catch (err) {
      throw new Error(
        `failed to resolve admin address from token via rest.getKey: ${err?.message || err}. ` +
        `Set GLOBAL_ADMIN_ADDRESS in env to bypass the lookup.`,
      );
    }
  }
  return tokenObj;
}

/**
 * Combine a concrete contract's source with all its imports into a
 * single Solidity blob, ready for `rest.createContract`. Mirrors the
 * `importer.combine` step in deploy/contract.js.
 */
async function combineSource(concreteRelPath) {
  const file = path.resolve(__dirname, "..", concreteRelPath);
  if (!fs.existsSync(file)) throw new Error(`source not found: ${file}`);
  let combined = await importer.combine(file);
  if (Buffer.isBuffer(combined)) return combined.toString();
  if (typeof combined === "string") return combined;
  if (Array.isArray(combined) || typeof combined === "object") {
    // blockapps-rest returns an array of [filename, source] tuples for
    // multi-file projects. Joining with stringification gives
    // `filename.sol,source` — strip the prefix and concatenate. Mirrors
    // deploy/contract.js's handler so a single helper change works
    // across all deploy entry points.
    const parts = Object.keys(combined).map((k) => {
      let content = combined[k];
      content = typeof content === "string" ? content : String(content);
      return content.replace(/^.*?\.sol,\s*/i, "");
    });
    return parts.join("\n");
  }
  return String(combined);
}

/**
 * Install the subset-aggregate proof path on an EthLightClient: deploy a
 * PlonkVerifier, load it with the circuit's verifying key, point the light
 * client at it, and store the committee digest for the bootstrapped period.
 *
 * Optional. Without BRIDGE_PROVER_URL the light client still anchors by
 * deriving the aggregate on-chain -- cheap enough at high participation,
 * several times a transaction's budget when participation dips.
 *
 * Safe to re-run: the verifying key lives in the verifier's storage, so a
 * circuit change is a redeploy plus a setAggregateVerifier, not a light-client
 * migration. A stale key cannot forge -- proofs against it simply stop
 * verifying.
 */
async function installAggregateVerifier(tokenObj, ownerAddr, ethLcAddr, bootstrap) {
  const proverUrl = (process.env.BRIDGE_PROVER_URL || "").replace(/\/$/, "");
  if (!proverUrl) {
    console.log("  BRIDGE_PROVER_URL unset — skipping; anchors will aggregate on-chain.");
    return undefined;
  }

  const { data: vk } = await axios.get(`${proverUrl}/vk`, { timeout: 30_000 });
  if (!vk || !Array.isArray(vk.words) || vk.words.length === 0) {
    throw new Error("prover /vk returned no verifying key (is its setup warm?)");
  }
  console.log(`  verifying key: ${vk.words.length} words, id ${vk.verifierId}`);

  // The digest must be over the committee the light client just bootstrapped,
  // or every proof for this period is rejected on-chain.
  const { data: commit } = await axios.post(
    `${proverUrl}/commitment`,
    { pubkeys: bootstrap.pubkeys },
    { timeout: 60_000, maxBodyLength: 8 * 1024 * 1024 },
  );
  if (!commit || !commit.commitment) throw new Error("prover /commitment returned nothing");
  console.log(`  committee digest: ${commit.commitment}`);

  const verifierLogic = await deployContract(
    tokenObj, "PlonkVerifier", "concrete/Plonk/PlonkVerifier.sol",
    { owner_: ownerAddr },
  );
  const verifierAddr = await deployProxy(tokenObj, verifierLogic, ownerAddr);
  console.log(`  PlonkVerifier proxy: ${verifierAddr}`);

  await callListAndWait([
    {
      contract: { name: "PlonkVerifier", address: strip0x(verifierAddr) },
      method: "initialize",
      args: { key: vk.words, id: vk.verifierId },
      txParams: { gasPrice: config.gasPrice, gasLimit: 32_100_000_000 },
    },
    {
      contract: { name: "EthLightClient", address: strip0x(ethLcAddr) },
      method: "setAggregateVerifier",
      args: { v: strip0x(verifierAddr) },
      txParams: { gasPrice: config.gasPrice, gasLimit: 32_100_000_000 },
    },
    {
      contract: { name: "EthLightClient", address: strip0x(ethLcAddr) },
      method: "setCommitteeCommitment",
      args: { period: bootstrap.period, commitment: commit.commitment },
      txParams: { gasPrice: config.gasPrice, gasLimit: 32_100_000_000 },
    },
  ]);
  console.log(`  ✓ proof path enabled for period ${bootstrap.period}`);
  return { verifier: verifierAddr, commitment: commit.commitment, verifierId: vk.verifierId };
}

async function deployContract(tokenObj, name, sourceRelPath, args) {
  const source = await combineSource(sourceRelPath);
  const contractArgs = {
    name,
    source,
    args,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  // Use the async-poll pattern from deploy/util.js. The sync path
  // through rest.createContract returns a malformed result shape
  // (`.data.contents` ends up null) on this version of blockapps-rest;
  // submitting async and polling getBlocResults is the proven path.
  const submitOpts = {
    config,
    history: name,
    cacheNonce: true,
    isAsync: true,
  };
  console.log(`  → deploying ${name} ...`);
  const submitResp = await rest.createContract(tokenObj, contractArgs, submitOpts);
  const responseArray = Array.isArray(submitResp) ? submitResp : [submitResp];

  const predicate = (results) =>
    results.filter((r) => r.status === "Pending").length === 0;
  const action = async () =>
    rest.getBlocResults(
      tokenObj,
      responseArray.map((r) => r.hash),
      { config, isAsync: true },
    );
  const finalResults = await util.until(
    predicate,
    action,
    { config, isAsync: true },
    3600000,
  );
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== "Success") {
    const err = final?.txResult?.message || final?.txResult?.response || JSON.stringify(final);
    throw new Error(`${name} deploy failed: ${err}`);
  }
  // `contractsCreated` is the new contract's address. Different
  // blockapps-rest versions return it as either a comma-joined string
  // ("0xabc..." / "abc...") or a single-element array
  // (["0xabc..."]). Normalize.
  let created = final?.txResult?.contractsCreated;
  if (Array.isArray(created)) created = created[0];
  if (typeof created !== "string" || !created) {
    throw new Error(
      `${name} deploy: no contractsCreated string in result: ${JSON.stringify(final?.txResult)}`,
    );
  }
  const addr = ensureHex(created);
  console.log(`  ✓ ${name} @ ${addr}`);
  return addr;
}

/**
 * Deploy a Proxy wrapping `logicAddr`. The Proxy stores all state
 * and delegatecalls into the logic contract for code. After this,
 * call `initialize(...)` on the proxy address to set up the
 * contract-specific state in proxy storage.
 *
 * Mirrors the BaseCodeCollection pattern:
 *   `new Proxy(logicAddr, ownerAddr)`
 */
async function deployProxy(tokenObj, logicAddr, ownerAddr) {
  return await deployContract(
    tokenObj, "Proxy", "concrete/Proxy/Proxy.sol",
    { _logicContract: ensureHex(logicAddr), _initialOwner: ensureHex(ownerAddr) },
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const profile = PROFILES[args.env];
  if (!profile) throw new Error(`unknown --env ${args.env}`);

  const l1DepositRouter =
    args.env === "testnet" ? args.sepoliaDepositRouter : args.mainnetDepositRouter;
  const l2DepositRouter =
    args.env === "testnet" ? args.baseSepoliaDepositRouter : args.baseDepositRouter;

  if (!l1DepositRouter || !l2DepositRouter) {
    throw new Error(
      "Both --sepolia-deposit-router and --base-sepolia-deposit-router " +
      "(or --mainnet/--base for prod) are required",
    );
  }
  const bridgeAddr = strip0x(args.bridgeAddr || process.env.MERCATA_BRIDGE_ADDR || DEFAULT_MERCATA_BRIDGE);

  console.log("=".repeat(72));
  console.log("Trustless bridge deploy plan");
  console.log("=".repeat(72));
  console.log(JSON.stringify({
    env: args.env,
    profile,
    bridgeAddr,
    l1DepositRouter,
    l2DepositRouter,
    apply: args.apply,
  }, null, 2));

  // 1. Fetch live sync-committee for bootstrap (do this first — biggest
  //    failure surface, cheap to retry, no STRATO state changed yet).
  console.log("\n[1/7] Fetching live sync committee from beacon API...");
  const bootstrap = await fetchBootstrapInputs(profile.beaconUrl);
  console.log(`  finalized slot: ${bootstrap.finalizedSlot}`);
  console.log(`  period:         ${bootstrap.period}`);
  console.log(`  fork version:   ${bootstrap.forkVersion}`);
  console.log(`  GVR:            ${bootstrap.genesisValidatorsRoot}`);
  console.log(`  pubkeys:        ${bootstrap.pubkeys.length} × 48B compressed G1`);

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply to deploy.");
    return;
  }

  const tokenObj = await getAdminToken();
  const ownerAddr = tokenObj.userAddress;
  if (!ownerAddr || /^0x0+$/.test(ownerAddr)) {
    throw new Error("ownerAddr resolved to zero address — Ownable would reject");
  }
  console.log(`Admin address      : ${ownerAddr}`);

  // Deployment pattern: each upgradeable contract is deployed as a
  // logic contract (only `owner_` in its ctor) + a Proxy whose
  // `logicContract` points at the logic. All state-bearing config goes
  // through `initialize()` on the Proxy, which delegatecalls into the
  // logic and writes Proxy storage.
  //
  // The `bridgeIns` mapping on MercataBridge always points at the
  // PROXY address — that's the stable address users / orchestrator /
  // mint authorization all reference. The logic contract is never
  // called directly in production; it's the upgrade target.

  // 2. Deploy EthLightClient (logic + proxy).
  console.log("\n[2/7] Deploying EthLightClient (logic + proxy)...");
  const ethLcLogic = await deployContract(
    tokenObj, "EthLightClient", "concrete/Bridge/EthLightClient.sol",
    { owner_: ownerAddr },
  );
  const ethLcAddr = await deployProxy(tokenObj, ethLcLogic, ownerAddr);
  console.log(`  EthLightClient proxy: ${ethLcAddr}`);
  // EthLightClient has no initialize() — its only state-bearing setup
  // is the bootstrap() call in the next step, which the proxy
  // delegatecalls just like any other admin method.

  // 3. Bootstrap EthLightClient with the live committee. Targets the
  //    PROXY; storage lands in proxy slots.
  //
  //    SolidVM's JSON-RPC ABI wants statically-sized bytes args
  //    (bytes32, bytes4) as raw Base16 strings — no `0x` prefix and
  //    exactly the right number of hex chars. The beacon API returns
  //    them with the `0x` prefix, so strip and pad before sending.
  console.log("\n[3/7] EthLightClient.bootstrap(...) ...");
  await callListAndWait([
    {
      contract: { name: "EthLightClient", address: strip0x(ethLcAddr) },
      method: "bootstrap",
      args: {
        period: bootstrap.period,
        pubkeys: bootstrap.pubkeys.map(strip0x),                 // bytes[] (each 48B)
        genesisValidatorsRoot_: strip0x(bootstrap.genesisValidatorsRoot), // bytes32
        forkVersion_: strip0x(bootstrap.forkVersion),            // bytes4
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: 32_100_000_000 },
    },
  ]);
  console.log(`  ✓ bootstrapped period ${bootstrap.period}`);

  // 3b. Optional: enable the proof path for the period just bootstrapped.
  console.log("\n[3b] Installing the subset-aggregate verifier (optional)...");
  const aggregate = await installAggregateVerifier(tokenObj, ownerAddr, ethLcAddr, bootstrap);

  // 4. Deploy EthBridgeIn for the L1 source chain (logic + proxy + initialize).
  console.log("\n[4/7] Deploying EthBridgeIn (L1 flavor)...");
  const l1BridgeInLogic = await deployContract(
    tokenObj, "EthBridgeIn", "concrete/Bridge/EthBridgeIn.sol",
    { owner_: ownerAddr },
  );
  const l1BridgeIn = await deployProxy(tokenObj, l1BridgeInLogic, ownerAddr);
  console.log(`  EthBridgeIn (L1) proxy: ${l1BridgeIn}`);
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(l1BridgeIn) },
      method: "initialize",
      args: {
        lightClient_: ethLcAddr,
        srcChainId_: profile.l1ChainId,
        depositRouter_: l1DepositRouter,
        depositRoutedSig_: strip0x(DEPOSIT_ROUTED_SIG),       // bytes32
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // 5. Deploy BaseLightClient (logic + proxy + initialize).
  console.log("\n[5/7] Deploying BaseLightClient...");
  const baseLcLogic = await deployContract(
    tokenObj, "BaseLightClient", "concrete/Bridge/BaseLightClient.sol",
    { owner_: ownerAddr },
  );
  const baseLcAddr = await deployProxy(tokenObj, baseLcLogic, ownerAddr);
  console.log(`  BaseLightClient proxy: ${baseLcAddr}`);
  await callListAndWait([
    {
      contract: { name: "BaseLightClient", address: strip0x(baseLcAddr) },
      method: "initialize",
      args: {
        l1LightClient_: ethLcAddr,
        disputeGameFactory_: profile.l2DisputeGameFactory,
        disputeGameCreatedSig_: strip0x(DISPUTE_GAME_CREATED_SIG), // bytes32
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // 6. Deploy EthBridgeIn for the L2 (Base) source chain.
  console.log("\n[6/7] Deploying EthBridgeIn (Base flavor)...");
  const l2BridgeInLogic = await deployContract(
    tokenObj, "EthBridgeIn", "concrete/Bridge/EthBridgeIn.sol",
    { owner_: ownerAddr },
  );
  const l2BridgeIn = await deployProxy(tokenObj, l2BridgeInLogic, ownerAddr);
  console.log(`  EthBridgeIn (Base) proxy: ${l2BridgeIn}`);
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(l2BridgeIn) },
      method: "initialize",
      args: {
        lightClient_: baseLcAddr,
        srcChainId_: profile.l2ChainId,
        depositRouter_: l2DepositRouter,
        depositRoutedSig_: strip0x(DEPOSIT_ROUTED_SIG),       // bytes32
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // 7. Wire setMintTarget on each bridge-in + setBridgeIn on MercataBridge.
  //    These all target the PROXY addresses.
  console.log("\n[7/7] Wiring MercataBridge + mint targets...");
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(l1BridgeIn) },
      method: "setMintTarget",
      args: { newTarget: ensureHex(bridgeAddr) },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    {
      contract: { name: "EthBridgeIn", address: strip0x(l2BridgeIn) },
      method: "setMintTarget",
      args: { newTarget: ensureHex(bridgeAddr) },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    {
      contract: { name: "MercataBridge", address: bridgeAddr },
      method: "setBridgeIn",
      args: { srcChainId: profile.l1ChainId, newBridge: l1BridgeIn },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    {
      contract: { name: "MercataBridge", address: bridgeAddr },
      method: "setBridgeIn",
      args: { srcChainId: profile.l2ChainId, newBridge: l2BridgeIn },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── Done ────────────────────────────────────────────────────────────
  const out = {
    env: args.env,
    bridgeAddr: ensureHex(bridgeAddr),
    proxies: {
      ethLightClient: ethLcAddr,
      baseLightClient: baseLcAddr,
      ethBridgeIn_l1: l1BridgeIn,
      ethBridgeIn_l2: l2BridgeIn,
    },
    logicContracts: {
      ethLightClient: ethLcLogic,
      baseLightClient: baseLcLogic,
      ethBridgeIn_l1: l1BridgeInLogic,
      ethBridgeIn_l2: l2BridgeInLogic,
    },
    bootstrap: {
      period: bootstrap.period,
      forkVersion: bootstrap.forkVersion,
      genesisValidatorsRoot: bootstrap.genesisValidatorsRoot,
    },
    aggregateProof: aggregate ?? null,
    chains: {
      [profile.l1ChainId]: { bridgeIn: l1BridgeIn, lightClient: ethLcAddr },
      [profile.l2ChainId]: { bridgeIn: l2BridgeIn, lightClient: baseLcAddr },
    },
  };

  const logDir = path.join(__dirname, "deployment-logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const filename = path.join(
    logDir,
    `trustless-bridge-${args.env}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(filename, JSON.stringify(out, null, 2));

  console.log("\n" + "=".repeat(72));
  console.log("DONE");
  console.log("=".repeat(72));
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nLog written to ${filename}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("deployTrustlessBridge failed:", err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
