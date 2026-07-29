import { AsyncLocalStorage } from "async_hooks";

interface RequestStore {
  externalSigning: boolean;
  userAddress: string;
  unsignedTxs?: any[];
}

export const requestContext = new AsyncLocalStorage<RequestStore>();
