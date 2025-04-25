export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state",
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = {
  poolFactory: "dc81e759ce479ca29f294528615da783c87ea9b2",
  lendingPool: "0b5a2fdd0ed435a71d6ad27f04c9b8083e798296",
  DECIMALS: 10n ** 18n,
};
