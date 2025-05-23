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
  const configs = {
    prod: {
      poolFactory: "TBD",
      lendingPool: "TBD",
      onRamp: "TBD",
    },
    testnet: {
      poolFactory: "a55d216907d9ae9b53645f872b8e10f987b6ffa9",
      lendingPool: "cd125a1785355c52d894b8539409b73579423f6f",
      onRamp: "1303452c1a0c734b55bee1483991c3289d4038a4",
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
    DECIMALS: 10n ** 18n,
  };
})();

export const stripeConfig = {
  confirmUrl: `/api/onRamp/buy`,
  cancelUrl: `/api/onRamp/cancel`,
};
