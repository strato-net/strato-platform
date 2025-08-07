const { callListAndWait, getEnvVar } = require("../../util");
const constants = require("../../config");

/**
 * Automates the post-deployment initialization for a fresh LendingPool setup.
 * Steps implemented mirror the SMD checklist:
 *   2. setTokenFactory
 *   3. setBorrowableAsset
 *   4. setMToken
 *   5. configureAsset (USDST + additional collaterals via env list)
 *   6. setAssetPrice on PriceOracle
 *   7. add LiquidityPool as minter & burner on mUSDST
 *   8. approve LiquidityPool as spender on USDST & mUSDST
 *   9. approve CollateralVault as spender on collateral tokens
 */

async function main() {
  // Helper: accept both POOL_CONFIGURATOR and POOL_CONFIGURATOR_ADDRESS env names
  const readAddr = (base) => {
    const short = process.env[base];
    const suffixed = process.env[`${base}_ADDRESS`];
    const val = short || suffixed;
    if (!val) throw new Error(`Missing env var: set ${base} (preferred) or ${base}_ADDRESS`);
    return val;
  };

  // Read mandatory env vars (either naming style works now)
  const POOL_CONFIGURATOR = readAddr("POOL_CONFIGURATOR");
  const PRICE_ORACLE = readAddr("PRICE_ORACLE");
  const LIQUIDITY_POOL = readAddr("LIQUIDITY_POOL");
  const COLLATERAL_VAULT = readAddr("COLLATERAL_VAULT");

  const TOKEN_FACTORY = process.env.TOKEN_FACTORY_ADDRESS || "000000000000000000000000000000000000100b";
  const USDST = process.env.USDST_ADDRESS || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
  const MUSDST = process.env.MUSDST_ADDRESS || "02672fbf704a1d173700ff40123e4af46c1e1457";

  // ─── Collateral tokens ────────────────────────────────────────────────
  const ETHST = process.env.ETHST_ADDRESS || "93fb7295859b2d70199e0a4883b7c320cf874e6c";
  const WBTCST = process.env.WBTCST_ADDRESS || "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9";
  const GOLDST = process.env.GOLDST_ADDRESS || "cdc93d30182125e05eec985b631c7c61b3f63ff0";
  const SILVST = process.env.SILVST_ADDRESS || "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94";

  const COLLATERAL_DEFAULTS = [ETHST, WBTCST, GOLDST, SILVST];

  // Allow env override list. Include defaults as well (avoid missing assets).
  let envColls = (process.env.COLLATERAL_LIST || "").split(",").filter(Boolean);
  // Support exclusion syntax: prefix address with '!' to exclude from defaults
  const excludes = new Set(envColls.filter((a) => a.startsWith("!")).map((a) => a.slice(1).toLowerCase()));
  envColls = envColls.filter((a) => !a.startsWith("!"));

  const COLLATERALS = Array.from(
    new Set(
      [...COLLATERAL_DEFAULTS, ...envColls].filter((a) => !excludes.has(a.toLowerCase()))
    )
  );

  // Build call list
  const calls = [];

  // 2. setTokenFactory
  calls.push({
    contract: { address: POOL_CONFIGURATOR, name: "PoolConfigurator" },
    method: "setTokenFactory",
    args: { _tokenFactory: TOKEN_FACTORY },
  });

  // 3. setBorrowableAsset
  calls.push({
    contract: { address: POOL_CONFIGURATOR, name: "PoolConfigurator" },
    method: "setBorrowableAsset",
    args: { asset: USDST },
  });

  // 4. setMToken
  calls.push({
    contract: { address: POOL_CONFIGURATOR, name: "PoolConfigurator" },
    method: "setMToken",
    args: { mToken: MUSDST },
  });

  // 5. configureAsset for USDST and collaterals
  const addConfigureAsset = (asset) =>
    calls.push({
      contract: { address: POOL_CONFIGURATOR, name: "PoolConfigurator" },
      method: "configureAsset",
      args: {
        asset,
        ltv: 7500,
        liquidationThreshold: 8000,
        liquidationBonus: 10500,
        interestRate: 500,
        reserveFactor: 1000,
      },
    });

  addConfigureAsset(USDST);
  COLLATERALS.forEach(addConfigureAsset);

  // 6. setAssetPrice (assumes price = $1 for USDST, $100 for collaterals unless env overrides e.g., COLLATERAL_PRICES="addr1:200,addr2:50")
  const priceMap = {};
  (process.env.COLLATERAL_PRICES || "").split(",").forEach((pair) => {
    const [addr, price] = pair.split(":");
    if (addr && price) priceMap[addr.toLowerCase()] = price;
  });

  // Add sensible default fallback prices if none supplied
  const addFallback = (addr, wei) => {
    if (!priceMap[addr.toLowerCase()]) priceMap[addr.toLowerCase()] = wei;
  };

  addFallback(USDST, "1000000000000000000"); // $1
  addFallback(ETHST, "3000000000000000000000"); // $3000
  addFallback(WBTCST, "60000000000000000000000"); // $60000
  addFallback(GOLDST, "200000000000000000000"); // $200
  addFallback(SILVST, "250000000000000000"); // $0.25

  const addPrice = (asset, price) =>
    calls.push({
      contract: { address: PRICE_ORACLE, name: "PriceOracle" },
      method: "setAssetPrice",
      args: { asset, price },
    });

  // --- Write USDST price (borrowable asset) explicitly ---
  addPrice(USDST, priceMap[USDST.toLowerCase()]);

  COLLATERALS.forEach((addr) => {
    const p = priceMap[addr.toLowerCase()] || "100000000000000000000"; // default $100
    addPrice(addr, p);
  });

  // 7. add minter & burner roles on mUSDST (assuming TokenAccess interface)
  ["addMinter", "addBurner"].forEach((fn) => {
    calls.push({
      contract: { address: MUSDST, name: "Token" },
      method: fn,
      args: { accountAddress: LIQUIDITY_POOL },
    });
  });

  // helper to approve
  const approveCall = (token, spender) => ({
    contract: { address: token, name: "Token" },
    method: "approve",
    args: { spender, value: "115792089237316195423570985008687907853269984665640564039457584007913129639935" }, // uint256 max
  });

  // 8. approve LiquidityPool on USDST & MUSDST
  calls.push(approveCall(USDST, LIQUIDITY_POOL));
  calls.push(approveCall(MUSDST, LIQUIDITY_POOL));

  // 9. approve CollateralVault on collaterals
  COLLATERALS.forEach((addr) => {
    calls.push(approveCall(addr, COLLATERAL_VAULT));
    // Also approve LiquidityPool for collateral token (optional but useful)
    calls.push(approveCall(addr, LIQUIDITY_POOL));
  });

  console.log("Submitting", calls.length, "initialization calls …");
  const results = await callListAndWait(calls);

  // ─── Post-execution validation ────────────────────────────────────────────
  const resultArray = Array.isArray(results) ? results : [results];

  const isBenign = (msg = "") =>
    /already\s+(?:a\s+)?(burner|minter)|already\s+approved|already\s+set/i.test(msg);

  const formatCall = (idx) => {
    const c = calls[idx] || {};
    return `${c.contract?.name || 'Unknown'}#${c.method || 'unknown'}`;
  };

  const hardFailures = [];
  const benignFailures = [];

  resultArray.forEach((res, idx) => {
    const statusOk = res.status === 'Success';
    if (statusOk) return;

    const errMsg = String(
      res.error || res.message || res.reason || res.txResult?.message || ""
    );
    const entry = { call: formatCall(idx), status: res.status, errMsg };
    if (isBenign(errMsg)) benignFailures.push(entry);
    else hardFailures.push(entry);
  });

  if (benignFailures.length) {
    console.warn('\nℹ️  Ignored non-critical reverts (already set):');
    benignFailures.forEach((f) =>
      console.warn(`   • ${f.call}  →  ${f.errMsg}`)
    );
  }

  if (hardFailures.length) {
    console.error('\n❌  One or more initialization calls failed:');
    hardFailures.forEach((f) =>
      console.error(`   • ${f.call}  →  ${f.errMsg || f.status}`)
    );
    throw new Error('Initialization encountered unrecoverable failures. Aborting.');
  }

  console.log(
    `✅  Initialization succeeded with ${resultArray.length - benignFailures.length} actual state-changing txs ( ${benignFailures.length} idempotent warnings ).`
  );

  // ─── Post-price verification ───────────────────────────────────────────

  const verifyPriceCalls = COLLATERALS.concat(USDST).map((asset) => ({
    contract: { address: PRICE_ORACLE, name: "PriceOracle" },
    method: "getAssetPrice",
    args: { asset },
  }));

  const verifyResults = await callListAndWait(verifyPriceCalls);
  const zeroPrices = (Array.isArray(verifyResults) ? verifyResults : [verifyResults])
    .map((r, i) => ({ price: r.data?.contents?.[0] || "0", asset: verifyPriceCalls[i].args.asset }))
    .filter(({ price }) => price === "0" || price === 0 || price === "0x0");

  if (zeroPrices.length) {
    console.error("\n❌ Price verification failed – zero price for:");
    zeroPrices.forEach((z) => console.error(`   • ${z.asset}`));
    throw new Error("Price verification failed");
  }
  console.log("✅  Price verification passed – all assets have non-zero price.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Init script failed:", err);
    process.exit(1);
  });
}

module.exports = main;