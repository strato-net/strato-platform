import { lendingPool, onRamp, poolFactory, tokenFactory, adminRegistry, poolConfigurator } from "./config";

export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
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
  const OnRamp = `${CONTRACT_PREFIX}OnRamp`;
  const LendingRegistry = `${CONTRACT_PREFIX}LendingRegistry`;
  const PoolConfigurator = `${CONTRACT_PREFIX}PoolConfigurator`;
  const AdminRegistry = `${CONTRACT_PREFIX}AdminRegistry`;
  
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
    "aToBRatio::text", 
    "bToARatio::text",
    `tokenA:tokenA_fkey(${tokenSelectFields.join(',')})`,
    "tokenABalance::text",
    `tokenB:tokenB_fkey(${tokenSelectFields.join(',')})`,
    "tokenBBalance::text",
    `lpToken:lpToken_fkey(${tokenSelectFields.join(',')})`,
  ];
  const registrySelectFields = [
    "lendingPool: lendingPool_fkey(" +
      "address," +
      `loans:${LendingPool}-loans(key,LoanInfo:value),` +
      `interestRate:${LendingPool}-assetInterestRate(asset:key,rate:value),` +
      `collateralRatio:${LendingPool}-assetCollateralRatio(asset:key,ratio:value),` +
      `liquidationBonus:${LendingPool}-assetLiquidationBonus(asset:key,bonus:value))`,
    "oracle:priceOracle_fkey(" +
      "address," +
      `prices:${PriceOracle}-prices(asset:key,price:value::text))`,
    "liquidityPool:liquidityPool_fkey(" +
      "address," +
      `deposited:${LiquidityPool}-deposited(key,Deposit:value),` +
      `totalLiquidity:${LiquidityPool}-totalLiquidity(asset:key,amount:value),` +
      `borrowed:${LiquidityPool}-borrowed(key,Borrow:value))`,
    "collateralVault:collateralVault_fkey(" +
      "address," +
      `collaterals:${CollateralVault}-collaterals(key,Collateral:value))`,
  ];

  const onRampSelectFields = [
    "address",
    `priceOracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(asset:key,price:value::text))`,
    `listings:${OnRamp}-listings(key,ListingInfo:value)`,
    `paymentProviders:${OnRamp}-paymentProviders(key,PaymentProviderInfo:value)`,
  ];
  return {
    poolFactory,
    lendingPool,
    onRamp,
    tokenFactory,
    poolConfigurator,
    adminRegistry,
    Token,
    TokenFactory,
    LendingPool,
    LiquidityPool,
    CollateralVault,
    PriceOracle,
    PoolFactory,
    Pool,
    OnRamp,
    LendingRegistry,
    PoolConfigurator,
    AdminRegistry,
    tokenSelectFields,
    tokenBalanceSelectFields,
    poolSelectFields,
    registrySelectFields,
    onRampSelectFields,
    DECIMALS: 10n ** 18n,
  };
})();

export const stripeConfig = {
  confirmUrl: `/api/onRamp/buy`,
  cancelUrl: `/api/onRamp/cancel`,
};
