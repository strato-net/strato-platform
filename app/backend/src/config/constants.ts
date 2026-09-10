import { lendingRegistry, poolFactory, tokenFactory, adminRegistry, mercataGovernance, mercataBridge, externalAssetBridge, cdpRegistry, voucher, safetyModule, sToken, priceOracle, liquidityPool, lendingPool } from "./config";
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
  const NFT = `${CONTRACT_PREFIX}NFT`;
  const NFTFactory = `${CONTRACT_PREFIX}NFTFactory`;
  const PositionManagerV3 = `${CONTRACT_PREFIX}PositionManagerV3`;
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
  const ExternalAssetBridge = `${CONTRACT_PREFIX}ExternalAssetBridge`;
  const StratoNativeBridge = `${CONTRACT_PREFIX}StratoNativeBridge`;
  const StratoNativeCustodyVault = `${CONTRACT_PREFIX}StratoNativeCustodyVault`;
  const StratoStaking = `${CONTRACT_PREFIX}StratoStaking`;
  const ValidatorRegistry = `${CONTRACT_PREFIX}ValidatorRegistry`;
  const MercataGovernance = "MercataGovernance";
  const CreditCardTopUp = `${CONTRACT_PREFIX}CreditCardTopUp`;
  const CDPEngine = `${CONTRACT_PREFIX}CDPEngine`;
  const CDPVault = `${CONTRACT_PREFIX}CDPVault`;
  const CDPRegistry = `${CONTRACT_PREFIX}CDPRegistry`;
  const Rewards = `${CONTRACT_PREFIX}Rewards`;
  const Voucher = `${CONTRACT_PREFIX}Voucher`;
  const Vault = `${CONTRACT_PREFIX}Vault`;
  const VaultFactory = `${CONTRACT_PREFIX}VaultFactory`;
  const SaveUSDSTVault = `${CONTRACT_PREFIX}SaveUSDSTVault`;
  const YieldVault = `${CONTRACT_PREFIX}YieldVault`;
  const MetalForge = `${CONTRACT_PREFIX}MetalForge`;
  const SafetyModule = `${CONTRACT_PREFIX}SafetyModule`;
  const DirectMintPSM = `${CONTRACT_PREFIX}DirectMintPSM`;
  const TokenRouter = `${CONTRACT_PREFIX}TokenRouter`;
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
    mercataGovernance,
    cdpRegistry,
    Token,
    TokenFactory,
    NFT,
    NFTFactory,
    PositionManagerV3,
    get nftFactory() { return config.nftFactory; },
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
    ExternalAssetBridge,
    StratoNativeBridge,
    StratoNativeCustodyVault,
    StratoStaking,
    ValidatorRegistry,
    MercataGovernance,
    CreditCardTopUp,
    CDPEngine,
    CDPVault,
    CDPRegistry,
    Rewards,
    Voucher,
    Vault,
    VaultFactory,
    SaveUSDSTVault,
    YieldVault,
    MetalForge,
    SafetyModule,
    DirectMintPSM,
    TokenRouter,
    get directMintPsm() { return config.directMintPsm; },
    get tokenRouter() { return config.tokenRouter; },
    get metalForge() { return config.metalForge; },
    get saveUsdstVault() { return config.saveUsdstVault; },
    get vaultFactory() { return config.vaultFactory; },  // Use getter to get current value after init
    get vault() { return config.vault; },  // Use getter to get current value after init
    priceOracle,
    liquidityPool,
    lendingPool,
    safetyModule,
    sToken,
    mercataBridge,
    externalAssetBridge,
    get stratoNativeBridge() { return config.stratoNativeBridge; },
    get stratoNativeCustodyVault() { return config.stratoNativeCustodyVault; },
    get stratoToken() { return config.stratoToken; },
    get stratoStaking() { return config.stratoStaking; },
    get validatorRegistry() { return config.validatorRegistry; },
    get creditCardTopUp() { return config.creditCardTopUp; },  // Use getter to get current value after init
    Event,
    tokenSelectFields,
    tokenBalanceSelectFields,
    // Swap constants
    Pool: SWAP_CONTRACTS.Pool,
    PoolFactory: SWAP_CONTRACTS.PoolFactory,
    PoolSwap: SWAP_CONTRACTS.PoolSwap,
    StablePool: SWAP_CONTRACTS.StablePool,
    StablePoolCoins: SWAP_CONTRACTS.StablePoolCoins,
    StablePoolTokenBalances: SWAP_CONTRACTS.StablePoolTokenBalances,
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
    ZERO_ADDRESS: "0000000000000000000000000000000000000000",
    DAY_MS: 24 * 60 * 60 * 1000,
    // Use getter to get current value after init
    get EXECUTED_ISSUES_LOOKBACK_DAYS() { return config.executedIssuesLookbackDays; },
    BPS_DIVISOR: 10000,
    voucher,
  };
})();
