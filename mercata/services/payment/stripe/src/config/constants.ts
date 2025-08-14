import { onRamp } from "./config";

export enum StratoPaths {
  transactionParallel = "/transaction/parallel?resolve=true",
  key = "/key",
  state = "/contracts/tate/:contractAddress/state", //@adrian why tate?
  identity = "/identity",
  result = "/transactions/results",
}

export const constants = {
  onRamp,
};
