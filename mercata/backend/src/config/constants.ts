import { lendingRegistry, poolFactory, tokenFactory, adminRegistry, mercataBridge } from "./config";

export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/state/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = (() => {
  const CONTRACT_PREFIX = "BlockApps-Mercata-";
  const Token = `${CONTRACT_PREFIX}Token`;
  const TokenFactory = `${CONTRACT_PREFIX}TokenFactory`;
  const LendingPool = `${CONTRACT_PREFIX}LendingPool`;
  const LiquidityPool = `${CONTRACT_PREFIX}LiquidityPool`;
  const CollateralVault = `${CONTRACT_PREFIX}CollateralVault`;
  const PriceOracle = `${CONTRACT_PREFIX}PriceOracle`;
  const PoolFactory = `${CONTRACT_PREFIX}PoolFactory`;
  const Pool = `${CONTRACT_PREFIX}Pool`;
  const PoolSwap = `${CONTRACT_PREFIX}Pool-Swap`;
  const PriceOracleEvents = `${CONTRACT_PREFIX}PriceOracle-PriceUpdated`;
  const LendingRegistry = `${CONTRACT_PREFIX}LendingRegistry`;
  const PoolConfigurator = `${CONTRACT_PREFIX}PoolConfigurator`;
  const AdminRegistry = `${CONTRACT_PREFIX}AdminRegistry`;
  const MercataBridge = `${CONTRACT_PREFIX}MercataBridge`;
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
    `images:${Token}-images(value)`,
    `attributes:${Token}-attributes(key,value)`,
    `balances:${Token}-_balances(user:key,balance:value::text)`,
    `minters:${Token}-minters(user:key,value)`,
    `burners:${Token}-burners(user:key,value)`,
  ];
  const tokenBalanceSelectFields = [
    "address",
    "user:key",
    "balance:value::text",
    `token:${Token}(${tokenSelectFields.join(',')})`,
  ];
  const poolSelectFields = [
    "address",
    "_owner",
    "swapFeeRate",
    "lpSharePercent",
    "aToBRatio::text", 
    "bToARatio::text",
    `tokenA:tokenA_fkey(${tokenSelectFields.join(',')})`,
    "tokenABalance::text",
    `tokenB:tokenB_fkey(${tokenSelectFields.join(',')})`,
    "tokenBBalance::text",
    `lpToken:lpToken_fkey(${tokenSelectFields.join(',')})`,
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

  const swapHistorySelectFields = [
    "address",
    "id",
    "block_timestamp",
    "sender",
    "tokenIn",
    "tokenOut", 
    "amountIn::text",
    "amountOut::text",
    "pool:BlockApps-Mercata-Pool(tokenA:tokenA_fkey(address,symbol:_symbol),tokenB:tokenB_fkey(address,symbol:_symbol))",
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
    Token,
    TokenFactory,
    LendingPool,
    LiquidityPool,
    CollateralVault,
    PriceOracle,
    PoolFactory,
    Pool,
    PoolSwap,
    PriceOracleEvents,
    LendingRegistry,
    PoolConfigurator,
    AdminRegistry,
    MercataBridge,
    mercataBridge,
    Event,
    tokenSelectFields,
    tokenBalanceSelectFields,
    poolSelectFields,
    registrySelectFields,
    swapHistorySelectFields,
    priceHistorySelectFields,
    DECIMALS: 10n ** 18n,
  };
})();
