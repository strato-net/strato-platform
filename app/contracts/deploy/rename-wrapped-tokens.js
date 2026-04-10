/**
 * Batch rename script for wrapped tokens and their LP tokens.
 *
 * Calls Token.setNameAndSymbol(name_, symbol_) on each target.
 *
 * Dry-run by default. Use --apply to execute transactions.
 *
 * Usage:
 *   node deploy/rename-wrapped-tokens.js
 *   node deploy/rename-wrapped-tokens.js --apply
 */
require("dotenv").config();
const config = require("./config");
const auth = require("./auth");
const { rest } = require("blockapps-rest");

// -----------------------------
// PROD DEPLOYMENTS
// -----------------------------
// ─── Wrapped token renames ───────────────────────────────────────────────────
const TOKEN_RENAMES = [
  { address: "93fb7295859b2d70199e0a4883b7c320cf874e6c", oldName: "ETHST",          oldSymbol: "ETHST",       newName: "STRATO ETH",        newSymbol: "ETH"        },
  { address: "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9", oldName: "WBTCST",         oldSymbol: "WBTCST",      newName: "STRATO WBTC",       newSymbol: "WBTC"       },
  { address: "2e4789eb7db143576da25990a3c0298917a8a87d", oldName: "rETHST",         oldSymbol: "rETHST",      newName: "STRATO rETH",       newSymbol: "rETH"       },
  { address: "f2aa370405030a434ae07e7826178325c675e925", oldName: "Wrapped wstETH",  oldSymbol: "wstETHST",    newName: "STRATO wstETH",     newSymbol: "wstETH"     },
  { address: "c6c3e9881665d53ae8c222e24ca7a8d069aa56ca", oldName: "syrupUSDCST",     oldSymbol: "syrupUSDCST", newName: "STRATO syrupUSDC",  newSymbol: "syrupUSDC"  },
  { address: "6e2d93d323edf1b3cc4672a909681b6a430cae64", oldName: "sUSDSST",         oldSymbol: "SUSDSST",     newName: "STRATO sUSDS",      newSymbol: "sUSDS"      },
  { address: "47de839c03a3b014c0cc4f3b9352979a5038f910", oldName: "XAUtST",          oldSymbol: "XAUTST",      newName: "STRATO XAUt",       newSymbol: "XAUt"       },
  { address: "491cdfe98470bfe69b662ab368826dca0fc2f24d", oldName: "PAXGST",          oldSymbol: "PAXGST",      newName: "STRATO PAXG",       newSymbol: "PAXG"       },
];

// ─── LP token renames (only those containing a renamed wrapped token) ────────
const LP_RENAMES = [
  { address: "0000000000000000000000000000000000001018", oldName: "ETHST-USDST LP Token",              oldSymbol: "ETHST-USDST-LP",        newName: "ETH-USDST LP Token",       newSymbol: "ETH-USDST-LP"       },
  { address: "69010124cdaa64286f6e413267a7001ea9379df4", oldName: "ETHST-WBTCST LP Token",             oldSymbol: "ETHST-WBTCST-LP",       newName: "ETH-WBTC LP Token",        newSymbol: "ETH-WBTC-LP"        },
  { address: "000000000000000000000000000000000000101a", oldName: "WBTCST-USDST LP Token",             oldSymbol: "WBTCST-USDST-LP",       newName: "WBTC-USDST LP Token",      newSymbol: "WBTC-USDST-LP"      },
  { address: "2e99b16c78474c437c7003c814ca79a3ba50e5d8", oldName: "Wrapped wstETH-USDST LP Token",     oldSymbol: "wstETHST-USDST-LP",     newName: "wstETH-USDST LP Token",    newSymbol: "wstETH-USDST-LP"    },
  { address: "d18a739fc9daa5ff19d2083b1f9b20823133b0cb", oldName: "rETHST-Wrapped wstETH LP Token",    oldSymbol: "rETHST-wstETHST-LP",    newName: "rETH-wstETH LP Token",     newSymbol: "rETH-wstETH-LP"     },
  { address: "a049efb1a3417801b3dd3877dd566aa24b95b3a0", oldName: "syrupUSDCST-USDST LP Token",        oldSymbol: "syrupUSDCST-USDST-LP",  newName: "syrupUSDC-USDST LP Token", newSymbol: "syrupUSDC-USDST-LP" },
  { address: "96c26f8306a0097d985d1654b4596c48bb6277c4", oldName: "sUSDSST-USDST LP Token",            oldSymbol: "SUSDSST-USDST-LP",      newName: "sUSDS-USDST LP Token",     newSymbol: "sUSDS-USDST-LP"     },
  { address: "af543d9086416b048564fa165f9587aa565cce2f", oldName: "XAUtST-GOLDST LP Token",            oldSymbol: "XAUTST-GOLDST-LP",      newName: "XAUt-GOLDST LP Token",     newSymbol: "XAUt-GOLDST-LP"     },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSetNameAndSymbolCall(entry) {
  return {
    contract: { address: entry.address, name: "Token" },
    method: "setNameAndSymbol",
    args: {
      name_: entry.newName,
      symbol_: entry.newSymbol,
    },
    txParams: {
      gasPrice: config.gasPrice,
      gasLimit: config.gasLimit,
    },
  };
}

function parseArgs() {
  return { apply: process.argv.includes("--apply") };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { apply } = parseArgs();
  const allRenames = [...TOKEN_RENAMES, ...LP_RENAMES];
  const plannedCalls = allRenames.map(buildSetNameAndSymbolCall);

  console.log("=== Wrapped Token Rename Plan ===\n");
  console.log(`Node URL: ${config.nodes?.[0]?.url || "(not set)"}`);
  console.log(`Mode:     ${apply ? "APPLY (live)" : "DRY RUN"}`);
  console.log(`Tokens:   ${TOKEN_RENAMES.length}`);
  console.log(`LP Tokens: ${LP_RENAMES.length}`);
  console.log(`Total calls: ${plannedCalls.length}\n`);

  console.log("── Token renames ──");
  for (const t of TOKEN_RENAMES) {
    console.log(`  ${t.address}  name: "${t.oldName}" -> "${t.newName}"  symbol: ${t.oldSymbol} -> ${t.newSymbol}`);
  }

  console.log("\n── LP token renames ──");
  for (const t of LP_RENAMES) {
    console.log(`  ${t.address}  name: "${t.oldName}" -> "${t.newName}"  symbol: ${t.oldSymbol} -> ${t.newSymbol}`);
  }

  if (!apply) {
    console.log("\nDry run only. Planned calls:");
    console.log(JSON.stringify(plannedCalls, null, 2));
    console.log("\nRe-run with --apply to execute.");
    return;
  }

  const username = process.env.GLOBAL_ADMIN_NAME;
  const password = process.env.GLOBAL_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("GLOBAL_ADMIN_NAME and GLOBAL_ADMIN_PASSWORD are required");
  }

  console.log(`\nAuthenticating as ${username}...`);
  const token = await auth.getUserToken(username, password);
  const tokenObj = { token };
  console.log(`Authenticated as ${username}\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allRenames.length; i++) {
    const entry = allRenames[i];
    const call = plannedCalls[i];

    console.log(`\n--- [${i + 1}/${allRenames.length}] ${entry.address} ---`);
    console.log(`  name:   "${entry.oldName}" -> "${entry.newName}"`);
    console.log(`  symbol: ${entry.oldSymbol} -> ${entry.newSymbol}`);

    let ok = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await rest.call(tokenObj, call, { config, cacheNonce: true });
        console.log(`  [OK] ${JSON.stringify(result)}`);
        ok = true;
        break;
      } catch (err) {
        console.error(`  [FAIL attempt ${attempt}/3] ${err.message}`);
        if (attempt < 3) {
          console.log(`  Waiting 10s before retry...`);
          await new Promise((r) => setTimeout(r, 10000));
        }
      }
    }
    if (ok) successCount++;
    else failCount++;
  }

  console.log(`\n=== Done. ${successCount}/${allRenames.length} succeeded, ${failCount} failed. ===`);
  if (failCount > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("rename-wrapped-tokens failed:", error.message);
    process.exit(1);
  });
}

module.exports = { main };
