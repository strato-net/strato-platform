/**
 * Add Linea support to an already-deployed trustless-bridge stack.
 *
 * Prerequisites: deployTrustlessBridge.js has already been run, so we
 * have a working EthLightClient + MercataBridge on STRATO. This script
 * only adds the Linea-side pieces:
 *
 *   1. LineaLightClient                (wraps the existing EthLightClient)
 *   2. EthBridgeIn (Linea-flavor)      (srcChainId = 59144 / 59141)
 *   3. setMintTarget(MercataBridge)    on the Linea bridge-in
 *   4. MercataBridge.setBridgeIn(chainId, addr)
 *
 * Usage:
 *   node deploy/deployLineaToTrustlessBridge.js \
 *     --env prod \
 *     --eth-light-client 0xETHLC \
 *     --linea-deposit-router 0xLINEADR \
 *     --apply
 *
 * For Linea testnet (Sepolia) deployment, use `--env testnet`. Defaults
 * to a dry-run (`--apply` executes). All STRATO writes go through the
 * GLOBAL_ADMIN credentials in env.
 *
 * Required env (same as deployTrustlessBridge.js):
 *   GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD
 *   NODE_URL
 *   OAUTH_URL / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
 *
 * Optional env:
 *   MERCATA_BRIDGE_ADDR  (default: 0000000000000000000000000000000000001008)
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const { rest, util, importer } = require("blockapps-rest");
const config = require("./config");
const auth = require("./auth");
const { callListAndWait } = require("./util");

const DEFAULT_MERCATA_BRIDGE = "0000000000000000000000000000000000001008";

/**
 * Linea profiles. The LineaRollup proxy address is the L1 contract we
 * search DataFinalizedV3 events on; it's stable per network and won't
 * change behind us (only the implementation upgrades). The
 * dataFinalizedSig is the keccak of the V3 event signature — bumped
 * if Linea releases V4 with a different shape.
 */
const PROFILES = {
  testnet: {
    lineaChainId: 59141, // Linea Sepolia
    l1ChainId: 11155111,
    lineaRollup: "0xB218f8A4Bc926cF1cA7b3423c154a0D627Bdb7E5",
  },
  prod: {
    lineaChainId: 59144, // Linea mainnet
    l1ChainId: 1,
    lineaRollup: "0xd19d4B5d358258f05D7B411E21A1460D11B0876F",
  },
};

/// keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
/// keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
const DEPOSIT_ROUTED_SIG_V1 =
  "0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750";
/// keccak256("DepositRouted(address,uint256,address,address,address,uint96,uint256)")
/// V2 appends `maxFee` -- the most a depositor will leave a fast-fill LP.
const DEPOSIT_ROUTED_SIG_V2 =
  "0xfc5b47f88f9cf2b26372a1037d51adf3e637958ea873f7eda09cc87c30687a9f";

/// An EthBridgeIn is bound to ONE event shape: a claim whose topic[0] does not
/// match is rejected outright, so pointing a bridge-in at a router of the other
/// generation fails silently -- deposits simply never become claimable. Pick it
/// from the router being wired, via --router-event-version (default v1, which
/// is what every currently deployed router emits).
const DEPOSIT_ROUTED_SIG =
  (process.env.ROUTER_EVENT_VERSION || "v1").toLowerCase() === "v2"
    ? DEPOSIT_ROUTED_SIG_V2
    : DEPOSIT_ROUTED_SIG_V1;

/// keccak256("DataFinalizedV3(uint256,uint256,bytes32,bytes32,bytes32)")
const DATA_FINALIZED_V3_SIG =
  "0xa0262dc79e4ccb71ceac8574ae906311ae338aa4a2044fd4ec4b99fad5ab60cb";

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
    if (a === "--eth-light-client") { out.ethLightClient = argv[++i]; continue; }
    if (a === "--linea-deposit-router") { out.lineaDepositRouter = argv[++i]; continue; }
    if (a === "--bridge-addr") { out.bridgeAddr = argv[++i]; continue; }
    throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

function ensureHex(addr) {
  if (!addr) throw new Error("missing address");
  return addr.startsWith("0x") ? addr.toLowerCase() : `0x${addr.toLowerCase()}`;
}
function strip0x(s) { return s.startsWith("0x") ? s.slice(2) : s; }

// ─────────────────────────────────────────────────────────────────────
// STRATO ops (lifted from deployTrustlessBridge.js — same patterns)
// ─────────────────────────────────────────────────────────────────────

async function getAdminToken() {
  const u = process.env.GLOBAL_ADMIN_NAME;
  const p = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!u || !p) throw new Error("GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD required");
  const tokenString = await auth.getUserToken(u, p);
  if (!tokenString) throw new Error("auth.getUserToken returned empty");
  const tokenObj = { token: tokenString };
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
 * blockapps-rest's `importer.combine` returns an array of
 * `[filename, sourceContents]` tuples for projects with multi-file
 * imports (this is most non-trivial contracts). The SolidVM compiler
 * expects a single concatenated source blob, so we have to join them
 * with newlines after stripping the `filename.sol,` prefix that the
 * Array.toString fallback produces.
 *
 * Mirrors the handler in deploy/contract.js — kept inline so this
 * script stays self-contained.
 */
async function combineSource(concreteRelPath) {
  const file = path.resolve(__dirname, "..", concreteRelPath);
  if (!fs.existsSync(file)) throw new Error(`source not found: ${file}`);
  let combined = await importer.combine(file);
  if (Buffer.isBuffer(combined)) return combined.toString();
  if (typeof combined === "string") return combined;
  if (typeof combined === "object") {
    // Works for both Arrays (numeric keys) and plain objects.
    const parts = Object.keys(combined).map((k) => {
      let content = combined[k];
      content = typeof content === "string" ? content : String(content);
      return content.replace(/^.*?\.sol,\s*/i, "");
    });
    return parts.join("\n");
  }
  return String(combined);
}

async function deployContract(tokenObj, name, sourceRelPath, args) {
  const source = await combineSource(sourceRelPath);
  const contractArgs = {
    name, source, args,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  const submitOpts = { config, history: name, cacheNonce: true, isAsync: true };
  console.log(`  → deploying ${name} ...`);
  const submitResp = await rest.createContract(tokenObj, contractArgs, submitOpts);
  const responseArray = Array.isArray(submitResp) ? submitResp : [submitResp];
  const predicate = (results) => results.filter((r) => r.status === "Pending").length === 0;
  const action = async () =>
    rest.getBlocResults(tokenObj, responseArray.map((r) => r.hash), { config, isAsync: true });
  const finalResults = await util.until(predicate, action, { config, isAsync: true }, 3600000);
  const final = Array.isArray(finalResults) ? finalResults[0] : finalResults;
  if (final.status !== "Success") {
    const err = final?.txResult?.message || final?.txResult?.response || JSON.stringify(final);
    throw new Error(`${name} deploy failed: ${err}`);
  }
  let created = final?.txResult?.contractsCreated;
  if (Array.isArray(created)) created = created[0];
  if (typeof created !== "string" || !created) {
    throw new Error(`${name} deploy: no contractsCreated string in result: ${JSON.stringify(final?.txResult)}`);
  }
  const addr = ensureHex(created);
  console.log(`  ✓ ${name} @ ${addr}`);
  return addr;
}

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

  const ethLcAddr = args.ethLightClient || process.env.ETH_LIGHT_CLIENT_ADDR;
  if (!ethLcAddr) {
    throw new Error(
      "--eth-light-client (or ETH_LIGHT_CLIENT_ADDR env) is required — " +
      "this is the proxy address of the EthLightClient from your prior " +
      "deployTrustlessBridge.js run.",
    );
  }
  const lineaDepositRouter = args.lineaDepositRouter;
  if (!lineaDepositRouter) {
    throw new Error("--linea-deposit-router is required");
  }
  const bridgeAddr = strip0x(args.bridgeAddr || process.env.MERCATA_BRIDGE_ADDR || DEFAULT_MERCATA_BRIDGE);

  console.log("=".repeat(72));
  console.log("Linea trustless bridge onboarding plan");
  console.log("=".repeat(72));
  console.log(JSON.stringify({
    env: args.env,
    profile,
    ethLightClient: ethLcAddr,
    lineaDepositRouter,
    bridgeAddr,
    apply: args.apply,
  }, null, 2));

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

  // 1. Deploy LineaLightClient (logic + proxy + initialize).
  console.log("\n[1/3] Deploying LineaLightClient...");
  const lineaLcLogic = await deployContract(
    tokenObj, "LineaLightClient", "concrete/Bridge/LineaLightClient.sol",
    { owner_: ownerAddr },
  );
  const lineaLcAddr = await deployProxy(tokenObj, lineaLcLogic, ownerAddr);
  console.log(`  LineaLightClient proxy: ${lineaLcAddr}`);
  await callListAndWait([
    {
      contract: { name: "LineaLightClient", address: strip0x(lineaLcAddr) },
      method: "initialize",
      args: {
        l1LightClient_: ethLcAddr,
        lineaRollup_: profile.lineaRollup,
        dataFinalizedSig_: strip0x(DATA_FINALIZED_V3_SIG),
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // 2. Deploy EthBridgeIn for Linea (logic + proxy + initialize).
  console.log("\n[2/3] Deploying EthBridgeIn (Linea flavor)...");
  const lineaBridgeInLogic = await deployContract(
    tokenObj, "EthBridgeIn", "concrete/Bridge/EthBridgeIn.sol",
    { owner_: ownerAddr },
  );
  const lineaBridgeIn = await deployProxy(tokenObj, lineaBridgeInLogic, ownerAddr);
  console.log(`  EthBridgeIn (Linea) proxy: ${lineaBridgeIn}`);
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(lineaBridgeIn) },
      method: "initialize",
      args: {
        lightClient_: lineaLcAddr,
        srcChainId_: profile.lineaChainId,
        depositRouter_: lineaDepositRouter,
        depositRoutedSig_: strip0x(DEPOSIT_ROUTED_SIG),
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // 3. Wire setMintTarget on Linea bridge-in + setBridgeIn on MercataBridge.
  console.log("\n[3/3] Wiring MercataBridge + mint target...");
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(lineaBridgeIn) },
      method: "setMintTarget",
      args: { newTarget: ensureHex(bridgeAddr) },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    {
      contract: { name: "MercataBridge", address: bridgeAddr },
      method: "setBridgeIn",
      args: { srcChainId: profile.lineaChainId, newBridge: lineaBridgeIn },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── Done ──────────────────────────────────────────────────────────
  const out = {
    env: args.env,
    bridgeAddr: ensureHex(bridgeAddr),
    proxies: {
      lineaLightClient: lineaLcAddr,
      ethBridgeIn_linea: lineaBridgeIn,
    },
    logicContracts: {
      lineaLightClient: lineaLcLogic,
      ethBridgeIn_linea: lineaBridgeInLogic,
    },
    chains: {
      [profile.lineaChainId]: { bridgeIn: lineaBridgeIn, lightClient: lineaLcAddr },
    },
  };

  const logDir = path.join(__dirname, "deployment-logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const filename = path.join(
    logDir,
    `trustless-bridge-linea-${args.env}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
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
    console.error("deployLineaToTrustlessBridge failed:", err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
