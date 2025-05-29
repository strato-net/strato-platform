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
      onRamp: "TBD",
    },
    testnet: {
      onRamp: "1bd046f77f8a5d75b5566149ecc55e8d694b8632",
    },
    testnet2: {
      onRamp: "5f0f4f4bdde0ed657c189351685cfbd5b0d62a50",
    },
  };
  type Network = keyof typeof configs;
  const envNetwork = process.env["NETWORK"];
  const network: Network = (envNetwork === "prod" || envNetwork === "testnet" || envNetwork === "testnet2") ? envNetwork : "testnet2";
  const selected = configs[network];
  return {
    ...selected,
  };
})();
