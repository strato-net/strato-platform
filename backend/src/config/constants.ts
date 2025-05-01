export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = {
  poolFactory: "7f48b17043776a8999bfae2bead474ae148f5ec9",
  lendingPool: "96b7b8a3868699971abe853daef3c2ede04f6c2b",
  DECIMALS: 10n ** 18n,
};
