import { baseCodeCollection, lendingPool, onRamp, poolFactory } from "./config";

export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = (() => {
  const Token = "BlockApps-Mercata-Token";
  const LendingPool = "BlockApps-Mercata-LendingPool";
  const LiquidityPool = "BlockApps-Mercata-LiquidityPool";
  const CollateralVault = "BlockApps-Mercata-CollateralVault";
  const PriceOracle = "BlockApps-Mercata-PriceOracle";
  const PoolFactory = "BlockApps-Mercata-PoolFactory";
  const Pool = "BlockApps-Mercata-Pool";
  const OnRamp = "BlockApps-Mercata-OnRamp";
  const LendingRegistry = "BlockApps-Mercata-LendingRegistry";
  const tokenSelectFields = [
    "address",
    "_name",
    "_symbol",
    "_owner",
    "customDecimals",
    "description",
    `images:${Token}-images(value)`,
    `attributes:${Token}-attributes(key,value)`,
    `balances:${Token}-_balances(user:key,balance:value)`,
    `minters:${Token}-minters(user:key,value)`,
    `burners:${Token}-burners(user:key,value)`,
  ];
  const tokenBalanceSelectFields = [
    "address",
    "user:key",
    "balance:value",
    `token:${Token}(_name,_symbol,_owner,customDecimals,description,images:${Token}-images(value),attributes:${Token}-attributes(key,value),minters:${Token}-minters(user:key,value),burners:${Token}-burners(user:key,value))`,
  ];
  const poolSelectFields = [
    "address",
    "aToBRatio",
    "bToARatio",
    `tokenA:tokenA_fkey(address,_name,_symbol,_owner,customDecimals,balances:${Token}-_balances(user:key,balance:value),description,images:${Token}-images(value),attributes:${Token}-attributes(key,value),minters:${Token}-minters(user:key,value),burners:${Token}-burners(user:key,value))`,
    "tokenABalance",
    `tokenB:tokenB_fkey(address,_name,_symbol,_owner,customDecimals,balances:${Token}-_balances(user:key,balance:value),description,images:${Token}-images(value),attributes:${Token}-attributes(key,value),minters:${Token}-minters(user:key,value),burners:${Token}-burners(user:key,value))`,
    "tokenBBalance",
    `lpToken:lpToken_fkey(address,_name,_symbol,_totalSupply,customDecimals,balances:${Token}-_balances(user:key,balance:value))`,
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
      `prices:${PriceOracle}-prices(asset:key,price:value))`,
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
    `priceOracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(asset:key,price:value))`,
    `listings:${OnRamp}-listings(key,ListingInfo:value)`,
    `paymentProviders:${OnRamp}-paymentProviders(key,PaymentProviderInfo:value)`,
    `approvedTokens:${OnRamp}-approvedTokens(token:key,value)`,
    `listingProviders:${OnRamp}-listingProviders(paymentProvider:key2,value)`,
  ];
  return {
    baseCodeCollection,
    poolFactory,
    lendingPool,
    onRamp,
    Token,
    LendingPool,
    LiquidityPool,
    CollateralVault,
    PriceOracle,
    PoolFactory,
    Pool,
    OnRamp,
    LendingRegistry,
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
