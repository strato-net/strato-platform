export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = {
  poolFactory: "7f48b17043776a8999bfae2bead474ae148f5ec9",
  lendingPool: "94788d10f794355501beff2638aaa36e3cd6059a",
  DECIMALS: 10n ** 18n,
};
