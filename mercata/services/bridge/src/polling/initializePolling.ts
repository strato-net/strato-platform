import { config } from "../config";
import { startDepositTxPolling, startWithdrawalTxPolling } from "./alchemyPolling";

export async function initializeAlchemyPolling() {
 
  await startDepositTxPolling(config.polling.bridgeInInterval);
  await startWithdrawalTxPolling(config.polling.bridgeOutInterval);
}