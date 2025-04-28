export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = {
  poolFactory: "1ca2d535a8bcb2b88d681ef56589e70223e8885f",
  lendingPool: "0da8f2beb3ec371dc023d2b7ad8a63a5a810e3eb",
  DECIMALS: 10n ** 18n,
};
