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
  // Read mandatory env vars
  const POOL_CONFIGURATOR = getEnvVar("POOL_CONFIGURATOR_ADDRESS");
  const PRICE_ORACLE = getEnvVar("PRICE_ORACLE_ADDRESS");
  const LIQUIDITY_POOL = getEnvVar("LIQUIDITY_POOL_ADDRESS");
  const COLLATERAL_VAULT = getEnvVar("COLLATERAL_VAULT_ADDRESS");

  const TOKEN_FACTORY = process.env.TOKEN_FACTORY_ADDRESS || "000000000000000000000000000000000000100b";
  const USDST = process.env.USDST_ADDRESS || "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";
  const MUSDST = process.env.MUSDST_ADDRESS || "02672fbf704a1d173700ff40123e4af46c1e1457";

  // Default GOLDST collateral address
  const GOLDST = "cdc93d30182125e05eec985b631c7c61b3f63ff0";

  // Example collaterals list: "<addr1>,<addr2>"; if none given use GOLDST as default
  let COLLATERALS = (process.env.COLLATERAL_LIST || "").split(",").filter(Boolean);
  if (COLLATERALS.length === 0) COLLATERALS = [GOLDST];

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

  // Default GOLD price if not provided
  if (!priceMap[GOLDST]) {
    priceMap[GOLDST] = "3350000000000000000000"; // $3350 * 1e18
  }

  const addPrice = (asset, price) =>
    calls.push({
      contract: { address: PRICE_ORACLE, name: "PriceOracle" },
      method: "setAssetPrice",
      args: { asset, price },
    });

  addPrice(USDST, "1000000000000000000"); // $1, 1e18
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
  console.log("Initialization complete:", results);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Init script failed:", err);
    process.exit(1);
  });
}

module.exports = main; 