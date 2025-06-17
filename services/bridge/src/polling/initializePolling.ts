import { startDepositTxPolling, startWithdrawalTxPolling } from "./alchemyPolling";

export async function initializeAlchemyPolling() {
  console.log("🚀 Initializing Alchemy get transaction receipt Polling");
  // await startDepositTxPolling();
  await startWithdrawalTxPolling();
}
