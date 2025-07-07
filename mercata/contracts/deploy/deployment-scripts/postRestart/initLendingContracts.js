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
  // ──────────────────────────────────────────────────────────────────────────
  // Helper utilities
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Strips an optional "0x" prefix, lower-cases the value and asserts that the
   * result is a 40-char hex string. All contract & token addresses MUST be fed
   * through this normaliser before being sent to Mercata APIs which expect
   * plain lowercase hex (see repo rules).
   *
   * @param {string} value Raw address (with/without 0x, mixed case)
   * @param {string} [name] Optional human-readable label for clearer errors
   * @returns {string} Sanitised 40-char lowercase hex string
   */
  const sanitiseAddress = (value, name = 'address') => {
    if (!value) throw new Error(`Empty ${name}`);
    const cleaned = String(value).toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{40}$/.test(cleaned)) {
      throw new Error(`Invalid ${name}: ${value}`);
    }
    return cleaned;
  };

  /**
   * Reads an env var supporting both FOO and FOO_ADDRESS naming conventions and
   * returns the sanitised hex string.
   *
   * @param {string} base Base name (e.g. "POOL_CONFIGURATOR")
   */
  const readAddr = (base) => {
    const short = process.env[base];
    const suffixed = process.env[`${base}_ADDRESS`];
    const val = short || suffixed;
    if (!val) throw new Error(`Missing env var: set ${base} (preferred) or ${base}_ADDRESS`);
    return sanitiseAddress(val, base);
  };

  // Helper for optional addresses (supports BOTH NAME and NAME_ADDRESS env vars)
  const readOptAddr = (base, fallback) => {
    const raw = process.env[base] || process.env[`${base}_ADDRESS`] || fallback;
    return sanitiseAddress(raw, base);
  };

  // Read mandatory env vars (either naming style works now)
  const POOL_CONFIGURATOR = readAddr("POOL_CONFIGURATOR");
  const PRICE_ORACLE = readAddr("PRICE_ORACLE");
  const LIQUIDITY_POOL = readAddr("LIQUIDITY_POOL");
  const COLLATERAL_VAULT = readAddr("COLLATERAL_VAULT");

  /* ─── Pre-flight: ensure all mandatory contracts exist ─────────────────────── */
  const mandatoryContracts = [
    { name: "PoolConfigurator", addr: POOL_CONFIGURATOR },
    { name: "PriceOracle", addr: PRICE_ORACLE },
    { name: "LiquidityPool", addr: LIQUIDITY_POOL },
    { name: "CollateralVault", addr: COLLATERAL_VAULT },
  ];

  const axios = require("axios");
  const NODE_URL = process.env.STRATO_NODE_URL || process.env.NODE_URL;
  const ROOT = (NODE_URL || "").replace(/\/+$/, "");
  const BASE = ROOT.includes("/strato/") ? ROOT : `${ROOT}/strato/v2.3`;

  const missing = [];
  for (const c of mandatoryContracts) {
    const url = `${BASE}/contract/${c.name}/${c.addr}`;
    try {
      await axios.get(url);
    } catch (_) {
      missing.push(`${c.name}@${c.addr}`);
    }
  }
  if (missing.length) {
    throw new Error(`Pre-flight failed – contract(s) not found in node: ${missing.join(", ")}`);
  }

  // Optional addresses: fall back to well-known defaults, but always sanitise
  const TOKEN_FACTORY = readOptAddr("TOKEN_FACTORY", "000000000000000000000000000000000000100b");
  const USDST = readOptAddr("USDST", "937efa7e3a77e20bbdbd7c0d32b6514f368c1010");
  const MUSDST = readOptAddr("MUSDST", "02672fbf704a1d173700ff40123e4af46c1e1457");

  // ─── Collateral tokens ────────────────────────────────────────────────
  const ETHST = readOptAddr("ETHST", "93fb7295859b2d70199e0a4883b7c320cf874e6c");
  const WBTCST = readOptAddr("WBTCST", "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9");
  const GOLDST = readOptAddr("GOLDST", "cdc93d30182125e05eec985b631c7c61b3f63ff0");
  const SILVST = readOptAddr("SILVST", "2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94");

  const COLLATERAL_DEFAULTS = [ETHST, WBTCST, GOLDST, SILVST];

  // Allow env override list. Include defaults as well (avoid missing assets).
  let envCollsRaw = (process.env.COLLATERAL_LIST || "").split(",").filter(Boolean);
  // Support exclusion syntax: prefix address with '!' to exclude from defaults
  const excludes = new Set(envCollsRaw.filter((a) => a.startsWith("!")).map((a) => sanitiseAddress(a.slice(1), 'excludedCollateral')));
  const envColls = envCollsRaw
    .filter((a) => !a.startsWith("!"))
    .map((a) => sanitiseAddress(a, 'collateral'));

  const COLLATERALS = Array.from(
    new Set(
      [...COLLATERAL_DEFAULTS, ...envColls].filter((a) => !excludes.has(a.toLowerCase()))
    )
  );

  // ─── 0. Ensure all tokens are ACTIVE and registered in the TokenFactory ─────
  const allTokens = [USDST, MUSDST, ...COLLATERALS];

  const tokenSetupCalls = [];

  // Helper to check token status via view call
  const callContract = async (contractName, address, method, args = []) => {
    const url = `${BASE}/contract/${contractName}/${address}/call`;
    const params = { method, args: JSON.stringify(args) };
    const { data } = await axios.get(url, { params });
    return data;
  };

  for (const tok of allTokens) {
    try {
      const current = await callContract("Token", tok, "status");
      const statusNum = Number(current);
      if (statusNum !== 2) {
        tokenSetupCalls.push({
          contract: { address: tok, name: "Token" },
          method: "setStatus",
          args: { newStatus: 2 },
        });
      }
    } catch (_) {
      // if call fails, attempt setStatus anyway (token might exist but view reverted)
      tokenSetupCalls.push({
        contract: { address: tok, name: "Token" },
        method: "setStatus",
        args: { newStatus: 2 },
      });
    }
  }

  // register tokens with TokenFactory to mark as factory tokens
  tokenSetupCalls.push({
    contract: { address: TOKEN_FACTORY, name: "TokenFactory" },
    method: "registerMigratedTokens",
    args: { tokens: allTokens },
  });

  // Build call list
  const calls = [...tokenSetupCalls];

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
    /already\s+(?:a\s+)?(burner|minter)|already\s+approved|already\s+set|same\s+as\s+the\s+current\s+status/i.test(msg);

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