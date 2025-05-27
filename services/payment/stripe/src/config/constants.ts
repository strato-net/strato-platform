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
      onRamp: "ddb00b9b6191db29665f356d9ac7f43ce1c3df9f",
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
