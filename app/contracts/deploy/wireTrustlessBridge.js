/**
 * Step 7 of the trustless bridge deploy, on its own: point each EthBridgeIn at
 * MercataBridge, and authorise each of them on MercataBridge.
 *
 * Split out because the full deployer is not resumable -- every run deploys a
 * fresh set of contracts -- and this step has its own prerequisite. It calls
 * MercataBridge.setBridgeIn, which only exists on a MercataBridge carrying the
 * trustless bridge-in changes. Against an older one it fails with
 *
 *     Contract doesn't have a method named 'setBridgeIn'
 *
 * and the whole batch is rejected at submission, so nothing lands. Upgrade
 * MercataBridge first, then run this against the addresses the deployer
 * already produced, instead of redeploying five contracts to reach step 7.
 *
 * Usage:
 *   node deploy/wireTrustlessBridge.js \
 *     --l1-bridge-in 0x... --l2-bridge-in 0x... \
 *     --l1-chain-id 11155111 --l2-chain-id 84532 \
 *     [--bridge 0000000000000000000000000000000000001008] [--apply]
 *
 * Dry run by default.
 */

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const { callListAndWait } = require("./util");
const config = require("./config");

const DEFAULT_MERCATA_BRIDGE = "0000000000000000000000000000000000001008";
const strip0x = (s) => String(s || "").replace(/^0x/, "");
const ensureHex = (s) => (String(s).startsWith("0x") ? String(s) : `0x${s}`);

function parseArgs() {
  const out = { apply: false, bridge: DEFAULT_MERCATA_BRIDGE };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--l1-bridge-in") out.l1BridgeIn = argv[++i];
    else if (a === "--l2-bridge-in") out.l2BridgeIn = argv[++i];
    else if (a === "--l1-chain-id") out.l1ChainId = Number(argv[++i]);
    else if (a === "--l2-chain-id") out.l2ChainId = Number(argv[++i]);
    else if (a === "--bridge") out.bridge = strip0x(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  for (const k of ["l1BridgeIn", "l2BridgeIn", "l1ChainId", "l2ChainId"]) {
    if (!out[k]) throw new Error(`--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())} is required`);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const bridgeHex = ensureHex(args.bridge);

  const calls = [
    {
      contract: { name: "EthBridgeIn", address: strip0x(args.l1BridgeIn) },
      method: "setMintTarget",
      args: { newTarget: bridgeHex },
    },
    {
      contract: { name: "EthBridgeIn", address: strip0x(args.l2BridgeIn) },
      method: "setMintTarget",
      args: { newTarget: bridgeHex },
    },
    {
      contract: { name: "MercataBridge", address: strip0x(args.bridge) },
      method: "setBridgeIn",
      args: { srcChainId: args.l1ChainId, newBridge: ensureHex(args.l1BridgeIn) },
    },
    {
      contract: { name: "MercataBridge", address: strip0x(args.bridge) },
      method: "setBridgeIn",
      args: { srcChainId: args.l2ChainId, newBridge: ensureHex(args.l2BridgeIn) },
    },
  ];

  console.log("=".repeat(72));
  console.log("Trustless bridge wiring");
  console.log("=".repeat(72));
  console.log(JSON.stringify({ ...args, calls: calls.map((c) => `${c.method} on ${c.contract.name}`) }, null, 2));

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply.");
    console.log("NOTE: setBridgeIn needs a MercataBridge carrying the trustless");
    console.log("      bridge-in changes. Against an older one the whole batch is");
    console.log("      rejected and nothing lands.");
    return;
  }

  // callListAndWait acquires its own token from GLOBAL_ADMIN_NAME/PASSWORD.
  await callListAndWait(
    calls.map((c) => ({
      ...c,
      txParams: { gasPrice: config.gasPrice, gasLimit: 32_100_000_000 },
    })),
  );
  console.log("\n✓ wired");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("wireTrustlessBridge failed:", err.stack || err.message || err);
    process.exit(1);
  });
}

module.exports = { main };
