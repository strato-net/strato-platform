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

  const lendingPoolSelectFields = [
    "address",
    "oracle",
    "liquidityPool",
    "collateralVault",
    "loans:LendingPool-loans(*)",
    "interestRate:LendingPool-assetInterestRate(*)",
    "collateralRatio:LendingPool-assetCollateralRatio(*)",
    "liquidationBonus:LendingPool-assetLiquidationBonus(*)",
  ];

  const configs = {
    prod: {
      poolFactory: "TBD",
      lendingPool: "TBD",
      onRamp: "TBD",
    },
    testnet: {
      poolFactory: "ad5feba6e4d06c551d7ae477ea031120aaaddc2c",
      lendingPool: "70e164caddf5b9e89e7484f7f4490be61b05c997",
      onRamp: "261e49900fcdb016734696e705ef6b5c8d8026ac",
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
    lendingPoolSelectFields,
    DECIMALS: 10n ** 18n,
  };
})();

export const stripeConfig = {
  confirmUrl: `/api/onRamp/buy`,
  cancelUrl: `/api/onRamp/cancel`,
};
