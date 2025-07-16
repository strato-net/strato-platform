import { config } from "../config";
import { startDepositTxPolling, startWithdrawalTxPolling } from "./alchemyPolling";

export async function initializeAlchemyPolling() {
  console.log("🚀 Initializing Alchemy get transaction receipt Polling");
  console.log(`📊 Bridge-in polling interval: ${config.polling.bridgeInInterval / 1000 / 60} minutes`);
  console.log(`📊 Bridge-out polling interval: ${config.polling.bridgeOutInterval / 1000 / 60} minutes`);
  
  await startDepositTxPolling(config.polling.bridgeInInterval);
  await startWithdrawalTxPolling(config.polling.bridgeOutInterval);
}