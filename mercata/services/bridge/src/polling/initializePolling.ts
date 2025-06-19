import { startDepositTxPolling, startWithdrawalTxPolling } from "./alchemyPolling";

// Polling intervals in milliseconds
const BRIDGE_IN_POLLING_INTERVAL = 50 * 60 * 1000; // 50 minutes for bridge-in
const BRIDGE_OUT_POLLING_INTERVAL = 30 * 60 * 1000; // 30 minutes for bridge-out

export async function initializeAlchemyPolling() {
  console.log("🚀 Initializing Alchemy get transaction receipt Polling");
  console.log(`📊 Bridge-in polling interval: ${BRIDGE_IN_POLLING_INTERVAL / 1000 / 60} minutes`);
  console.log(`📊 Bridge-out polling interval: ${BRIDGE_OUT_POLLING_INTERVAL / 1000 / 60} minutes`);
  
  await startDepositTxPolling(BRIDGE_IN_POLLING_INTERVAL);
  // await startWithdrawalTxPolling(BRIDGE_OUT_POLLING_INTERVAL);
}