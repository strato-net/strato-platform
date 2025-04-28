export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = {
  poolFactory: "9949801e026e77a12534b8facf456f0b6b5cdcfc",
  lendingPool: "0da8f2beb3ec371dc023d2b7ad8a63a5a810e3eb",
  DECIMALS: 10n ** 18n,
};
