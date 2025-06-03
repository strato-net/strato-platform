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
    "_name",
    "_symbol",
    "_totalSupply",
    "aToBRatio",
    "bToARatio",
    "tokenA",
    "tokenABalance",
    "tokenB",
    "tokenBBalance",
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

  const configs = {
    prod: {
      baseCodeCollection: "TBD",
      poolFactory: "TBD",
      lendingPool: "TBD",
      onRamp: "TBD",
    },
    testnet: {
      baseCodeCollection: "0000000000000000000000000000000000001000",
      poolFactory: "000000000000000000000000000000000000100a",
      lendingPool: "0000000000000000000000000000000000001005",
      onRamp: "0000000000000000000000000000000000001009",
    },
    testnet2: {
      baseCodeCollection: "bb58dffe06470c5dbf179e9aafd00d097c7e77cf",
      poolFactory: "928d15e694d9be8b097b8d0e10f1ebe4afa440d1",
      lendingPool: "96b7b8a3868699971abe853daef3c2ede04f6c2b",
      onRamp: "5f0f4f4bdde0ed657c189351685cfbd5b0d62a50",
    },
  };
  type Network = keyof typeof configs;
  const envNetwork = process.env["NETWORK"];
  const network: Network =
    envNetwork === "prod" ||
    envNetwork === "testnet" ||
    envNetwork === "testnet2"
      ? envNetwork
      : "testnet2";
  const selected = configs[network];
  return {
    ...selected,
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
    DECIMALS: 10n ** 18n,
  };
})();

export const stripeConfig = {
  confirmUrl: `/api/onRamp/buy`,
  cancelUrl: `/api/onRamp/cancel`,
};
