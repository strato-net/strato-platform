import { config } from "../config";
import { startDepositTxPolling, startWithdrawalTxPolling } from "./alchemyPolling";
import { startEthereumContractPolling } from "./ethereumContractPolling";

export async function initializeAlchemyPolling() {
 
  // Commented out for now - will be replaced with Ethereum contract polling
  // await startDepositTxPolling(config.polling.bridgeInInterval);
  
  // New Ethereum contract polling flow
  await startEthereumContractPolling(config.polling.bridgeInInterval);
  
  await startWithdrawalTxPolling(config.polling.bridgeOutInterval);
}