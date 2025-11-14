import { cirrus } from "../../utils/mercataApiHelper";
import { constants } from "../../config/constants";
import { getServiceToken, createOrGetKey } from "../../utils/authHelper";
import { depositLiquidity } from "./lending.service";

const { MercataBridge, mercataBridge, USDST } = constants;

// Track seen events to avoid duplicate logging
const seenEvents = new Set<string>();

// Store intents (eventId -> callback)
interface Intent {
  eventId: string; // Format: `${externalChainId}-${externalTxHash}`
  userToken: string; // User's access token
  callback: (userToken: string, depositCompletedEvent: any) => Promise<void>;
  createdAt: Date;
}

const intents = new Map<string, Intent>();

/**
 * Create an intent for a USDST deposit
 * Called via API endpoint when user initiates deposit
 */
export const createIntent = (
  userToken: string,
  externalChainId: string,
  externalTxHash: string
): void => {
  const eventId = `${externalChainId}-${externalTxHash}`;
  
  if (intents.has(eventId)) {
    return;
  }

  const callback = async (token: string, event: any) => {
    try {
      // Get user address from token
      const userAddress = await createOrGetKey(token);
      
      // Query deposit info to get the amount
      const serviceToken = await getServiceToken();
      const { data: deposits } = await cirrus.get(serviceToken, `/${MercataBridge}-deposits`, {
        params: {
          address: `eq.${mercataBridge}`,
          select: "externalChainId:key,externalTxHash:key2,DepositInfo:value",
          key: `eq.${event.srcChainId}`,
          key2: `eq.${event.srcTxHash}`,
        },
      });

      if (!Array.isArray(deposits) || deposits.length === 0) {
        console.error(`[BridgeEventPolling] Deposit not found for event: ${event.srcChainId}-${event.srcTxHash}`);
        return;
      }

      const deposit = deposits[0];
      const depositInfo = deposit.DepositInfo;
      
      // Verify this is a USDST deposit
      if (!depositInfo?.stratoToken || depositInfo.stratoToken.toLowerCase() !== USDST.toLowerCase()) {
        console.log(`[BridgeEventPolling] Skipping non-USDST deposit: ${depositInfo?.stratoToken}`);
        return;
      }

      const amount = depositInfo.stratoTokenAmount;
      if (!amount || BigInt(amount) === 0n) {
        console.error(`[BridgeEventPolling] Invalid deposit amount: ${amount}`);
        return;
      }

      // Deposit liquidity (don't stake mToken, matching frontend behavior)
      console.log(`[BridgeEventPolling] Depositing ${amount} USDST to lending pool for user ${userAddress}`);
      const result = await depositLiquidity(token, userAddress, amount, false);
      
      if (result.status === "Success") {
        console.log(`[BridgeEventPolling] Successfully deposited liquidity. Tx: ${result.hash}`);
      } else {
        console.error(`[BridgeEventPolling] Liquidity deposit failed:`, result);
      }
    } catch (error) {
      console.error(`[BridgeEventPolling] Error executing auto-save callback:`, error);
      throw error; // Re-throw to prevent intent deletion on failure
    }
  };

  intents.set(eventId, {
    eventId,
    userToken,
    callback,
    createdAt: new Date(),
  });

  console.log(`[BridgeEventPolling] Created intent for event: ${eventId}`);
  console.log(intents);
};

/**
 * Poll for new DepositCompleted events and log them
 */
export const pollBridgeEvents = async (): Promise<void> => {
  try {
    const accessToken = await getServiceToken();
    
    // Query for DepositCompleted events
    // Event signature: DepositCompleted(uint256 srcChainId, string srcTxHash)
    const { data: events } = await cirrus.get(accessToken, `/${MercataBridge}-DepositCompleted`, {
      params: {
        address: `eq.${mercataBridge}`,
        select: "srcChainId,srcTxHash,block_timestamp,block_number",
        order: "block_timestamp.desc",
        limit: "100", // Get recent events
      },
    });

    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    // Process events in reverse order (oldest first) to see them chronologically
    const sortedEvents = [...events].reverse();

    for (const event of sortedEvents) {
      const eventId = `${event.srcChainId}-${event.srcTxHash}`;
      
      if (seenEvents.has(eventId)) {
        continue;
      }

      const intent = intents.get(eventId);
      if (intent) {
        try {
          await intent.callback(intent.userToken, event);
          intents.delete(eventId);
          seenEvents.add(eventId); // Only mark as seen after successful processing
        } catch (error) {
          console.error(`[BridgeEventPolling] Error executing intent callback:`, error);
          // Don't delete intent or mark as seen on error - allow retry on next poll
        }
      } else {
        // No intent for this event, mark as seen to skip in future polls
        seenEvents.add(eventId);
      }
    }
  } catch (error) {
    console.error(`[BridgeEventPolling] Error polling bridge events:`, error);
  }
};

/**
 * Start polling for bridge events
 * @param intervalMs Polling interval in milliseconds (default: 5 seconds)
 */
export const startBridgeEventPolling = (intervalMs: number = 5000): void => {
  console.log(`[BridgeEventPolling] Starting bridge event polling (interval: ${intervalMs}ms)`);
  
  // Poll immediately
  void pollBridgeEvents();
  
  // Then poll at interval
  setInterval(() => {
    void pollBridgeEvents();
  }, intervalMs);
};

