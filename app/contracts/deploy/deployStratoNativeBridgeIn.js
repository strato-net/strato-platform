/**
 * Add native-redemption support for one external chain to a deployed
 * proof-bridge stack.
 *
 * Prerequisites:
 *   1. deployTrustlessBridge.js has been run, so there's an
 *      EthLightClient / BaseLightClient / LineaLightClient (or
 *      BscLightClient via deployBscToTrustlessBridge.js) on STRATO for
 *      the target chain.
 *   2. StratoNativeBridge has been deployed and initialized on STRATO
 *      (the develop-branch merge does this).
 *   3. StratoNativeRepresentationBridge has been deployed on the
 *      external chain — its address goes in `--rep-bridge`.
 *
 * What this script does:
 *   1. Deploy `StratoNativeBridgeIn` (logic + Proxy + initialize) on STRATO.
 *      Initializer args:
 *        lightClient_              = light client for the source chain
 *        srcChainId_               = e.g. 11155111 / 8453 / 56 / 59144
 *        representationBridge_     = StratoNativeRepresentationBridge addr
 *        redemptionRequestedSig_   = keccak256("RedemptionRequested(address,uint256,address,address,uint96)")
 *   2. `StratoNativeBridgeIn.setRedemptionTarget(stratoNativeBridge)` —
 *      wires the verifier's callback into the bridge.
 *   3. `StratoNativeBridge.setNativeBridgeIn(srcChainId, bridgeIn)` —
 *      authorizes the verifier in the per-chain mapping. Until this
 *      runs, {creditNativeRedemptionWithProof} rejects with
 *      "SNB: trustless path disabled for chain".
 *
 * Usage:
 *   node deploy/deployStratoNativeBridgeIn.js \
 *     --env prod \
 *     --src-chain-id 56 \
 *     --light-client 0xBSCLC... \
 *     --rep-bridge 0xREPBRIDGE_ON_BSC \
 *     --apply
 *
 * Defaults to a dry-run. Required env (same as the other deploy scripts):
 *   GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD
 *   NODE_URL
 *   OAUTH_URL / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
 *
 * Optional env:
 *   STRATO_NATIVE_BRIDGE_ADDR  (default: cirrus lookup is your
 *                              responsibility — set the addr from your
 *                              StratoNativeBridge deployment)
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

/// keccak256("RedemptionRequested(address,uint256,address,address,uint96)")
/// Matches StratoNativeRepresentationBridge.sol and the backend's
/// {nativeRedemptionProof.service.ts}.REDEMPTION_REQUESTED_SIG.
const REDEMPTION_REQUESTED_SIG =
  "0x8c3e37d44910f9975cca29b1cbb70b943d7107cf2091576b3291d4316c74129a";

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
    if (a === "--src-chain-id") { out.srcChainId = parseInt(argv[++i], 10); continue; }
    if (a === "--light-client") { out.lightClient = argv[++i]; continue; }
    if (a === "--rep-bridge") { out.repBridge = argv[++i]; continue; }
    if (a === "--strato-native-bridge") { out.stratoNativeBridge = argv[++i]; continue; }
    throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.srcChainId) throw new Error("--src-chain-id is required");
  if (!out.lightClient) throw new Error("--light-client is required");
  if (!out.repBridge) throw new Error("--rep-bridge is required");
  return out;
}

function ensureHex(addr) {
  if (!addr) throw new Error("missing address");
  return addr.startsWith("0x") ? addr.toLowerCase() : `0x${addr.toLowerCase()}`;
}
function strip0x(s) { return s.startsWith("0x") ? s.slice(2) : s; }

// ─────────────────────────────────────────────────────────────────────
// STRATO ops (lifted from deployLineaToTrustlessBridge.js)
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

async function combineSource(concreteRelPath) {
  const file = path.resolve(__dirname, "..", concreteRelPath);
  if (!fs.existsSync(file)) throw new Error(`source not found: ${file}`);
  let combined = await importer.combine(file);
  if (Buffer.isBuffer(combined)) return combined.toString();
  if (typeof combined === "string") return combined;
  if (typeof combined === "object") {
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
  const stratoNativeBridge = strip0x(
    args.stratoNativeBridge ||
    process.env.STRATO_NATIVE_BRIDGE_ADDR ||
    ""
  );
  if (!stratoNativeBridge) {
    throw new Error(
      "StratoNativeBridge address required: pass --strato-native-bridge <addr> " +
      "or set STRATO_NATIVE_BRIDGE_ADDR env"
    );
  }

  console.log("=".repeat(72));
  console.log("StratoNativeBridgeIn onboarding plan");
  console.log("=".repeat(72));
  console.log(JSON.stringify({
    env: args.env,
    srcChainId: args.srcChainId,
    lightClient: args.lightClient,
    representationBridge: args.repBridge,
    stratoNativeBridge: ensureHex(stratoNativeBridge),
    redemptionRequestedSig: REDEMPTION_REQUESTED_SIG,
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

  // ─── 1. Deploy StratoNativeBridgeIn (logic + proxy + initialize).
  console.log("\n[1/2] Deploying StratoNativeBridgeIn...");
  const snbiLogic = await deployContract(
    tokenObj, "StratoNativeBridgeIn", "concrete/Bridge/StratoNativeBridgeIn.sol",
    { owner_: ownerAddr },
  );
  const snbi = await deployProxy(tokenObj, snbiLogic, ownerAddr);
  console.log(`  StratoNativeBridgeIn proxy: ${snbi}`);
  await callListAndWait([
    {
      contract: { name: "StratoNativeBridgeIn", address: strip0x(snbi) },
      method: "initialize",
      args: {
        lightClient_:             ensureHex(args.lightClient),
        srcChainId_:              args.srcChainId,
        representationBridge_:    ensureHex(args.repBridge),
        redemptionRequestedSig_:  strip0x(REDEMPTION_REQUESTED_SIG),
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── 2. Wire callback target + per-chain registration on SNB.
  console.log("\n[2/2] Wiring redemption target + per-chain bridgeIn...");
  await callListAndWait([
    {
      contract: { name: "StratoNativeBridgeIn", address: strip0x(snbi) },
      method: "setRedemptionTarget",
      args: { newTarget: ensureHex(stratoNativeBridge) },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    {
      contract: { name: "StratoNativeBridge", address: stratoNativeBridge },
      method: "setNativeBridgeIn",
      args: { externalChainId: args.srcChainId, newBridgeIn: snbi },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── Done ──────────────────────────────────────────────────────────
  const out = {
    env: args.env,
    srcChainId: args.srcChainId,
    stratoNativeBridge: ensureHex(stratoNativeBridge),
    proxies: {
      stratoNativeBridgeIn: snbi,
    },
    logicContracts: {
      stratoNativeBridgeIn: snbiLogic,
    },
    representationBridge: ensureHex(args.repBridge),
    lightClient: ensureHex(args.lightClient),
    redemptionRequestedSig: REDEMPTION_REQUESTED_SIG,
  };

  const logDir = path.join(__dirname, "deployment-logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const filename = path.join(
    logDir,
    `strato-native-bridge-in-${args.env}-chain${args.srcChainId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
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
    console.error("deployStratoNativeBridgeIn failed:", err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
