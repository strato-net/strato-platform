export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = (() => {
  const configs = {
    prod: {
      poolFactory: "TBD",
      lendingPool: "TBD",
      onRamp: "TBD",
    },
    testnet: {
      poolFactory: "TBD",
      lendingPool: "abdf1ff23ac358990da0af1fe20576709d662e6a",
      onRamp: "aca872083137af1d1f50cf6105b9320f789ef14a",
    },
    testnet2: {
      poolFactory: "928d15e694d9be8b097b8d0e10f1ebe4afa440d1",
      lendingPool: "96b7b8a3868699971abe853daef3c2ede04f6c2b",
      onRamp: "5f0f4f4bdde0ed657c189351685cfbd5b0d62a50",
    },
  };
  type Network = keyof typeof configs;
  const envNetwork = process.env["NETWORK"];
  const network: Network = (envNetwork === "prod" || envNetwork === "testnet" || envNetwork === "testnet2") ? envNetwork : "testnet2";
  const selected = configs[network];
  return {
    ...selected,
    DECIMALS: 10n ** 18n,
  };
})();

export const stripeConfig = {
  confirmUrl: `/api/onRamp/buy`,
  cancelUrl: `/api/onRamp/cancel`,
};
