/**
 * Add BNB Smart Chain (BSC) support to an already-deployed trustless-
 * bridge stack.
 *
 * Prerequisites: deployTrustlessBridge.js has already been run, so we
 * have a MercataBridge on STRATO. Unlike Base/Linea, BSC has no L1
 * piggyback — we deploy a self-contained BscLightClient that verifies
 * BSC's own BEP-126 BLS vote attestations against the current epoch's
 * validator set.
 *
 *   1. BscLightClient + Proxy
 *   2. BscLightClient.bootstrap(epochLength, epochBoundaryHeaderRLP)
 *        — pins the initial validator set from the chosen epoch's
 *          extraData. This is the single point of trust (one-time,
 *          owner-only).
 *   3. EthBridgeIn (BSC-flavor) + Proxy + initialize
 *        — same template as Eth/Base/Linea, just pointing at the
 *          BscLightClient.
 *   4. EthBridgeIn.setMintTarget(MercataBridge)
 *   5. MercataBridge.setBridgeIn(chainId, addr)
 *
 * Usage:
 *   node deploy/deployBscToTrustlessBridge.js \
 *     --env prod \
 *     --bsc-deposit-router 0xBSCDR \
 *     --apply
 *
 * For testnet (Chapel), use `--env testnet`. Defaults to a dry-run
 * (`--apply` executes). All STRATO writes go through GLOBAL_ADMIN.
 *
 * Required env (same as deployTrustlessBridge.js):
 *   GLOBAL_ADMIN_NAME / GLOBAL_ADMIN_PASSWORD
 *   NODE_URL
 *   OAUTH_URL / OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
 *
 * Optional env:
 *   RPC_URL_BSC / RPC_URL_BSC_TESTNET   (BSC JSON-RPC endpoint)
 *   MERCATA_BRIDGE_ADDR                 (default: …0000001008)
 *   BSC_BOOTSTRAP_BLOCK_OFFSET          (default: 2 epochs back from
 *                                        the BSC head, rounded down to
 *                                        the previous epoch boundary)
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const axios = require("axios");
const { encodeRlp, toBeArray, toBigInt, getBytes } = require("ethers");
const { rest, util, importer } = require("blockapps-rest");
const config = require("./config");
const auth = require("./auth");
const { callListAndWait } = require("./util");

const DEFAULT_MERCATA_BRIDGE = "0000000000000000000000000000000000001008";

/**
 * BSC profiles. The epoch length switched from 200 to 1000 at the
 * Lorentz hard fork on mainnet (already past on both networks as of
 * 2026), so we hard-code 1000. If we ever onboard a chain still on the
 * pre-Lorentz schedule, override via `--epoch-length`.
 */
const PROFILES = {
  testnet: {
    bscChainId: 97,                      // Chapel testnet
    rpcUrl: process.env.RPC_URL_BSC_TESTNET || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    epochLength: 1000,
  },
  prod: {
    bscChainId: 56,                      // BSC mainnet
    rpcUrl: process.env.RPC_URL_BSC || "https://bsc-dataseed.bnbchain.org",
    epochLength: 1000,
  },
};

/// keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
const DEPOSIT_ROUTED_SIG =
  "0x55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750";

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
    if (a === "--bsc-deposit-router") { out.bscDepositRouter = argv[++i]; continue; }
    if (a === "--bridge-addr") { out.bridgeAddr = argv[++i]; continue; }
    if (a === "--epoch-length") { out.epochLength = parseInt(argv[++i], 10); continue; }
    if (a === "--bootstrap-block") { out.bootstrapBlock = parseInt(argv[++i], 10); continue; }
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
// BSC RPC helpers
// ─────────────────────────────────────────────────────────────────────

async function bscRpc(rpcUrl, method, params) {
  const resp = await axios.post(rpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  if (resp.data?.error) {
    throw new Error(`BSC RPC ${method} failed: ${JSON.stringify(resp.data.error)}`);
  }
  return resp.data?.result;
}

/**
 * Encode an ints-and-bytes Ethereum block header into canonical RLP.
 *
 * Mirrors the backend's `rlpEncodeBlockHeader` (baseProof.service.ts)
 * but kept inline so this script stays self-contained. We round-trip
 * `keccak256(rlp(header)) === block.hash` at the call site to catch
 * any encoder drift.
 *
 * BSC headers don't include withdrawalsRoot / blobGasUsed / etc.
 * (those are Ethereum-specific post-Shanghai/Cancun fields), so the
 * encoded length is fixed at the pre-Shanghai 16 fields. The
 * conditional appends still trigger if a future BSC fork adds them.
 */
function rlpEncodeBlockHeader(b) {
  // Strip leading zeros from a hex int to produce minimum-byte BE form.
  // ethers' encodeRlp expects bytes, so we hand it Uint8Arrays.
  const intToBuf = (h) => {
    if (h === undefined || h === null) return new Uint8Array(0);
    if (h === "0x" || h === "0x0") return new Uint8Array(0);
    let s = h.startsWith("0x") ? h.slice(2) : h;
    if (s.length === 0) return new Uint8Array(0);
    if (s.length % 2) s = "0" + s;
    const buf = Buffer.from(s, "hex");
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    return new Uint8Array(buf.subarray(i));
  };
  const bytesField = (h) => {
    if (h === undefined || h === null) return new Uint8Array(0);
    const s = h.startsWith("0x") ? h.slice(2) : h;
    return new Uint8Array(Buffer.from(s, "hex"));
  };

  const fields = [
    bytesField(b.parentHash),
    bytesField(b.sha3Uncles),
    bytesField(b.miner),
    bytesField(b.stateRoot),
    bytesField(b.transactionsRoot),
    bytesField(b.receiptsRoot),
    bytesField(b.logsBloom),
    intToBuf(b.difficulty),
    intToBuf(b.number),
    intToBuf(b.gasLimit),
    intToBuf(b.gasUsed),
    intToBuf(b.timestamp),
    bytesField(b.extraData),
    bytesField(b.mixHash),
    bytesField(b.nonce),
  ];
  // Post-fork additions, only if present (BSC doesn't currently have
  // any of these, but the BSC team has discussed importing parts of
  // Ethereum's roadmap — keep the encoder forward-compatible).
  if (b.baseFeePerGas !== undefined) fields.push(intToBuf(b.baseFeePerGas));
  if (b.withdrawalsRoot !== undefined) fields.push(bytesField(b.withdrawalsRoot));
  if (b.blobGasUsed !== undefined) fields.push(intToBuf(b.blobGasUsed));
  if (b.excessBlobGas !== undefined) fields.push(intToBuf(b.excessBlobGas));
  if (b.parentBeaconBlockRoot !== undefined) fields.push(bytesField(b.parentBeaconBlockRoot));
  if (b.requestsHash !== undefined) fields.push(bytesField(b.requestsHash));
  return encodeRlp(fields);
}

/**
 * keccak256 of a hex-string or Uint8Array. We use ethers' built-in
 * keccak256 via a dynamic require so we don't have to ship a separate
 * dependency.
 */
function keccak(buf) {
  const { keccak256 } = require("ethers");
  return keccak256(buf);
}

/**
 * Pick a bootstrap epoch boundary block. By default: the most recent
 * boundary that's at least 2 epochs behind the tip — far enough to be
 * safely past any reorg window, close enough that nobody has to fast-
 * forward through many rotations on first use.
 */
async function pickBootstrapBoundary(rpcUrl, epochLength, override) {
  if (override) {
    if (override % epochLength !== 0) {
      throw new Error(
        `--bootstrap-block ${override} is not at an epoch boundary (epochLength=${epochLength})`,
      );
    }
    return override;
  }
  const tipHex = await bscRpc(rpcUrl, "eth_blockNumber", []);
  const tip = Number(BigInt(tipHex));
  const offset = Number(process.env.BSC_BOOTSTRAP_BLOCK_OFFSET || 2 * epochLength);
  // Round down to the previous epoch boundary.
  const candidate = Math.floor((tip - offset) / epochLength) * epochLength;
  if (candidate <= 0) {
    throw new Error(`pickBootstrapBoundary: BSC tip=${tip} too low to pick a boundary`);
  }
  return candidate;
}

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
  const profile = PROFILES[args.env];
  if (!profile) throw new Error(`unknown --env ${args.env}`);

  const bscDepositRouter = args.bscDepositRouter;
  if (!bscDepositRouter) {
    throw new Error("--bsc-deposit-router is required (DepositRouter address on BSC)");
  }
  const bridgeAddr = strip0x(args.bridgeAddr || process.env.MERCATA_BRIDGE_ADDR || DEFAULT_MERCATA_BRIDGE);
  const epochLength = args.epochLength || profile.epochLength;

  // ─── 1. Resolve bootstrap boundary + fetch header from BSC RPC.
  console.log("\nResolving bootstrap epoch boundary from BSC RPC...");
  const boundaryBlockNum = await pickBootstrapBoundary(
    profile.rpcUrl, epochLength, args.bootstrapBlock,
  );
  console.log(`  BSC tip-relative bootstrap boundary: block ${boundaryBlockNum} ` +
              `(epoch ${boundaryBlockNum / epochLength})`);

  const boundaryBlock = await bscRpc(
    profile.rpcUrl, "eth_getBlockByNumber",
    ["0x" + boundaryBlockNum.toString(16), false],
  );
  if (!boundaryBlock) {
    throw new Error(`pickBootstrapBoundary returned block ${boundaryBlockNum}, but RPC returned null`);
  }
  const boundaryRLP = rlpEncodeBlockHeader(boundaryBlock);
  const computedHash = keccak(boundaryRLP);
  if (computedHash.toLowerCase() !== boundaryBlock.hash.toLowerCase()) {
    throw new Error(
      `bootstrap header RLP round-trip failed: keccak(rlp)=${computedHash} ≠ block.hash=${boundaryBlock.hash}`,
    );
  }
  console.log(`  ✓ bootstrap header RLP round-trips (${strip0x(boundaryRLP).length / 2} bytes)`);

  console.log("=".repeat(72));
  console.log("BSC trustless bridge onboarding plan");
  console.log("=".repeat(72));
  console.log(JSON.stringify({
    env: args.env,
    profile: { ...profile, rpcUrl: profile.rpcUrl.replace(/\/.+@/, "/<redacted>@") },
    epochLength,
    bootstrapBlockNumber: boundaryBlockNum,
    bootstrapBlockHash: boundaryBlock.hash,
    bridgeAddr,
    bscDepositRouter,
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

  // ─── 2. Deploy BscLightClient (logic + proxy + bootstrap).
  console.log("\n[1/3] Deploying BscLightClient...");
  const bscLcLogic = await deployContract(
    tokenObj, "BscLightClient", "concrete/Bridge/BscLightClient.sol",
    { owner_: ownerAddr },
  );
  const bscLcAddr = await deployProxy(tokenObj, bscLcLogic, ownerAddr);
  console.log(`  BscLightClient proxy: ${bscLcAddr}`);
  await callListAndWait([
    {
      contract: { name: "BscLightClient", address: strip0x(bscLcAddr) },
      method: "bootstrap",
      args: {
        epochLength_:    epochLength,
        epochHeaderRLP:  strip0x(boundaryRLP),
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── 3. Deploy EthBridgeIn (BSC flavor).
  console.log("\n[2/3] Deploying EthBridgeIn (BSC flavor)...");
  const bscBridgeInLogic = await deployContract(
    tokenObj, "EthBridgeIn", "concrete/Bridge/EthBridgeIn.sol",
    { owner_: ownerAddr },
  );
  const bscBridgeIn = await deployProxy(tokenObj, bscBridgeInLogic, ownerAddr);
  console.log(`  EthBridgeIn (BSC) proxy: ${bscBridgeIn}`);
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(bscBridgeIn) },
      method: "initialize",
      args: {
        lightClient_:     bscLcAddr,
        srcChainId_:      profile.bscChainId,
        depositRouter_:   bscDepositRouter,
        depositRoutedSig_: strip0x(DEPOSIT_ROUTED_SIG),
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── 4. Wire mint target + per-chain bridgeIn entry.
  console.log("\n[3/3] Wiring MercataBridge + mint target...");
  await callListAndWait([
    {
      contract: { name: "EthBridgeIn", address: strip0x(bscBridgeIn) },
      method: "setMintTarget",
      args: { newTarget: ensureHex(bridgeAddr) },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
    {
      contract: { name: "MercataBridge", address: bridgeAddr },
      method: "setBridgeIn",
      args: { srcChainId: profile.bscChainId, newBridge: bscBridgeIn },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    },
  ]);

  // ─── Done ──────────────────────────────────────────────────────────
  const out = {
    env: args.env,
    bridgeAddr: ensureHex(bridgeAddr),
    proxies: {
      bscLightClient:   bscLcAddr,
      ethBridgeIn_bsc:  bscBridgeIn,
    },
    logicContracts: {
      bscLightClient:   bscLcLogic,
      ethBridgeIn_bsc:  bscBridgeInLogic,
    },
    bootstrap: {
      epochLength,
      blockNumber: boundaryBlockNum,
      blockHash:   boundaryBlock.hash,
    },
    chains: {
      [profile.bscChainId]: { bridgeIn: bscBridgeIn, lightClient: bscLcAddr },
    },
  };

  const logDir = path.join(__dirname, "deployment-logs");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const filename = path.join(
    logDir,
    `trustless-bridge-bsc-${args.env}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
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
    console.error("deployBscToTrustlessBridge failed:", err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
