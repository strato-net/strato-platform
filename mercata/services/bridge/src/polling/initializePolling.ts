import { config } from "../config";
import { 
  fetchWithdrawalRequestedTransactions, 
  startDepositTxPolling, 
  startWithdrawalTxPolling,
  checkDepositInitiatedOnEthContract 
} from "./alchemyPolling";

export async function initializeAlchemyPolling() {
 
  await startDepositTxPolling(config.polling.bridgeInInterval);
  await startWithdrawalTxPolling(config.polling.bridgeOutInterval);
  await fetchWithdrawalRequestedTransactions(config.polling.withdrawalInterval);
  await checkDepositInitiatedOnEthContract(config.polling.ethereumDepositInterval);
}