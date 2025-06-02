export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = (() => {
  const tokenSelectFields = [
    "address",
    "_name",
    "_symbol",
    "_owner",
    "customDecimals",
    "description",
    "images:Token-images(value)",
    "attributes:Token-attributes(key,value)",
    "balances:Token-_balances(user:key,balance:value)",
    "minters:Token-minters(user:key,value)",
    "burners:Token-burners(user:key,value)",
  ];
  const tokenBalanceSelectFields = [
    "address",
    "user:key",
    "balance:value",
    "token:Token(_name,_symbol,_owner,customDecimals,description,images:Token-images(value),attributes:Token-attributes(key,value),minters:Token-minters(user:key,value),burners:Token-burners(user:key,value))",
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
      "loans:LendingPool-loans(key,LoanInfo:value)," +
      "interestRate:LendingPool-assetInterestRate(asset:key,rate:value)," +
      "collateralRatio:LendingPool-assetCollateralRatio(asset:key,ratio:value)," +
      "liquidationBonus:LendingPool-assetLiquidationBonus(asset:key,bonus:value))",
    "oracle:priceOracle_fkey(" +
      "address," +
      "prices:PriceOracle-prices(asset:key,price:value))",
    "liquidityPool:liquidityPool_fkey(" +
      "address," +
      "deposited:LiquidityPool-deposited(key,Deposit:value)," +
      "totalLiquidity:LiquidityPool-totalLiquidity(asset:key,amount:value)," +
      "borrowed:LiquidityPool-borrowed(key,Borrow:value))",
    "collateralVault:collateralVault_fkey(" +
      "address," +
      "collaterals:CollateralVault-collaterals(key,Collateral:value))",
  ];

  const configs = {
    prod: {
      poolFactory: "TBD",
      lendingPool: "TBD",
      onRamp: "TBD",
    },
    testnet: {
      poolFactory: "d33fe6842d4ee45572f50e9bc8bd7138b6d95289",
      lendingPool: "3ea34e3516912b0bc5c54a6200e0fa010afc02f3",
      onRamp: "1bd046f77f8a5d75b5566149ecc55e8d694b8632",
    },
    testnet2: {
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
