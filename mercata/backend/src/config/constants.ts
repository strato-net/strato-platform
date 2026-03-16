import { lendingRegistry, poolFactory, tokenFactory, adminRegistry, mercataBridge, cdpRegistry, voucher, safetyModule, sToken, priceOracle, liquidityPool, lendingPool } from "./config";
import * as config from "./config";
import {
  SWAP_CONTRACTS,
  SWAP_TOKEN_SELECT_FIELDS,
  SWAP_POOL_SELECT_FIELDS,
  SWAP_HISTORY_SELECT_FIELDS
} from "./swapConstants";

export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/state/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = (() => {
  const CONTRACT_PREFIX = "BlockApps-";
  const Token = `${CONTRACT_PREFIX}Token`;
  const TokenFactory = `${CONTRACT_PREFIX}TokenFactory`;
  const LendingPool = `${CONTRACT_PREFIX}LendingPool`;
  const LiquidityPool = `${CONTRACT_PREFIX}LiquidityPool`;
  const CollateralVault = `${CONTRACT_PREFIX}CollateralVault`;
  const PriceOracle = `${CONTRACT_PREFIX}PriceOracle`;
  const PriceOracleEvents = `${CONTRACT_PREFIX}PriceOracle-PriceUpdated`;
  const PriceOracleBatchUpdateEvents = `${CONTRACT_PREFIX}PriceOracle-BatchPricesUpdated`;
  const LendingRegistry = `${CONTRACT_PREFIX}LendingRegistry`;
  const PoolConfigurator = `${CONTRACT_PREFIX}PoolConfigurator`;
  const AdminRegistry = `${CONTRACT_PREFIX}AdminRegistry`;
  const MercataBridge = `${CONTRACT_PREFIX}MercataBridge`;
  const CreditCardTopUp = `${CONTRACT_PREFIX}CreditCardTopUp`;
  const CDPEngine = `${CONTRACT_PREFIX}CDPEngine`;
  const CDPVault = `${CONTRACT_PREFIX}CDPVault`;
  const CDPRegistry = `${CONTRACT_PREFIX}CDPRegistry`;
  const RewardsChef = `${CONTRACT_PREFIX}RewardsChef`;
  const Rewards = `${CONTRACT_PREFIX}Rewards`;
  const Voucher = `${CONTRACT_PREFIX}Voucher`;
  const Vault = `${CONTRACT_PREFIX}Vault`;
  const VaultFactory = `${CONTRACT_PREFIX}VaultFactory`;
  const MetalForge = `${CONTRACT_PREFIX}MetalForge`;
  const SafetyModule = `${CONTRACT_PREFIX}SafetyModule`;
  const Event = "event";
    
  const tokenSelectFields = [
    "address",
    "_name",
    "_symbol",
    "_owner",
    "_totalSupply::text",
    "customDecimals",
    "description",
    "status",
    "_paused",
    `images:${Token}-images(value)`,
    `attributes:${Token}-attributes(key,value)`,
    `balances:${Token}-_balances(user:key,balance:value::text)`,
  ];

  const tokenBalanceSelectFields = [
    "address",
    "user:key", 
    "balance:value::text",
    `token:${Token}(address,_name,_symbol,_owner,_totalSupply::text,customDecimals,description,status,_paused,images:${Token}-images(value),attributes:${Token}-attributes(key,value))`
  ];

  const registrySelectFields = [
    "address",
    "lendingPool:lendingPool_fkey(" +
      "address," +
      "borrowableAsset," +
      "mToken," +
      "borrowIndex," +
      "totalScaledDebt," +
      "reservesAccrued," +
      "debtCeilingAsset," +
      "debtCeilingUSD," +
      "lastAccrual," +
      `userLoan:${LendingPool}-userLoan(user:key,LoanInfo:value),` +
      `assetConfigs:${LendingPool}-assetConfigs(asset:key,AssetConfig:value))`,
    "oracle:priceOracle_fkey(" +
      "address," +
      `prices:${PriceOracle}-prices(asset:key,price:value::text))`,
    "collateralVault:collateralVault_fkey(" +
      "address," +
      `userCollaterals:${CollateralVault}-userCollaterals(user:key,asset:key2,amount:value::text))`,
    "liquidityPool:liquidityPool_fkey(address)",
  ];

  const cdpRegistrySelectFields = [
    "address",
    "feeCollector",
    "tokenFactory", 
    "usdst",
    "cdpEngine:cdpEngine_fkey(" +
      "address," +
      "registry," +
      "globalPaused," +
      "RAY::text," +
      "WAD::text," +
      `collateralConfigs:${CDPEngine}-collateralConfigs(asset:key,CollateralConfig:value),` +
      `collateralGlobalStates:${CDPEngine}-collateralGlobalStates(asset:key,CollateralGlobalState:value),` +
      `vaults:${CDPEngine}-vaults(user:key,asset:key2,Vault:value),` +
      `isSupportedAsset:${CDPEngine}-isSupportedAsset(asset:key,value)` +
    ")",
    "cdpVault:cdpVault_fkey(" +
      "address," +
      "registry" +
    ")",
    "priceOracle:priceOracle_fkey(" +
      "address," +
      `prices:${PriceOracle}-prices(asset:key,value::text)` +
    ")",
  ];
  
  const priceHistorySelectFields = [
    "address",
    "id", 
    "block_timestamp",
    "asset",
    "price::text",
    "timestamp::text"
  ];

  return {
    poolFactory,
    lendingRegistry,
    tokenFactory,
    adminRegistry,
    cdpRegistry,
    Token,
    TokenFactory,
    LendingPool,
    LiquidityPool,
    CollateralVault,
    PriceOracle,
    PriceOracleEvents,
    PriceOracleBatchUpdateEvents,
    LendingRegistry,
    PoolConfigurator,
    AdminRegistry,
    MercataBridge,
    CreditCardTopUp,
    CDPEngine,
    CDPVault,
    CDPRegistry,
    RewardsChef,
    Rewards,
    Voucher,
    Vault,
    VaultFactory,
    MetalForge,
    SafetyModule,
    get metalForge() { return config.metalForge; },
    get vaultFactory() { return config.vaultFactory; },  // Use getter to get current value after init
    get vault() { return config.vault; },  // Use getter to get current value after init
    priceOracle,
    liquidityPool,
    lendingPool,
    safetyModule,
    sToken,
    mercataBridge,
    get creditCardTopUp() { return config.creditCardTopUp; },  // Use getter to get current value after init
    Event,
    tokenSelectFields,
    tokenBalanceSelectFields,
    // Swap constants
    Pool: SWAP_CONTRACTS.Pool,
    PoolFactory: SWAP_CONTRACTS.PoolFactory,
    PoolSwap: SWAP_CONTRACTS.PoolSwap,
    swapTokenSelectFields: SWAP_TOKEN_SELECT_FIELDS,
    swapSelectFields: SWAP_POOL_SELECT_FIELDS,
    swapHistorySelectFields: SWAP_HISTORY_SELECT_FIELDS,
    registrySelectFields,
    cdpRegistrySelectFields,
    priceHistorySelectFields,
    DECIMALS: 10n ** 18n,
    GAS_FEE: 0.01,
    GAS_FEE_WEI: 10n ** 16n, // 0.01 USDST in wei
    USDST: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
    voucher,
  };
})();
