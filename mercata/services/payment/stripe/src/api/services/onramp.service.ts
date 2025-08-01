import { strato, bloc } from "../../utils/mercataApiHelper";
import { stripe } from "../../utils/stripeClient";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { createCheckoutSession } from "../../utils/stripeClient";
import { Stripe } from "stripe";
import { getServiceToken } from "../../utils/authHelper";
import { RampData } from "../../types/types";
import { canLockAmount, addLock, removeLock, calculatePaymentAmount } from "../helpers/onramp.helper";
import { savePendingSession, removePendingSession, isPendingSession, getAllPendingSessions } from "../../utils/dbClient";

const contractAddress = constants.onRamp!;
const OnRamp = "OnRamp";

// In-memory tracking for immediate duplicate prevention within single process
const processingInProgress = new Set<string>();

/**
 * Resume polling for any sessions that were pending when the service restarted
 * Call this on service startup to recover from crashes/restarts
 */
export async function recoverPendingSessions(): Promise<void> {
  try {
    const pendingSessions = await getAllPendingSessions();
    
    if (pendingSessions.length === 0) {
      console.log('No pending sessions to recover');
      return;
    }
    
    console.log(`Recovering ${pendingSessions.length} pending sessions from database`);
    
    for (const sessionData of pendingSessions) {
      // Check if session is still valid with Stripe before resuming
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionData.sessionId);
        
        if (session.payment_status === 'paid') {
          console.log(`Resuming polling for paid session ${sessionData.sessionId}`);
          pollAndFulfillSession(sessionData.sessionId, sessionData.token, sessionData.tokenAmount).catch(err => {
            console.error(`Error resuming session ${sessionData.sessionId}:`, err);
          });
        } else if (session.status === 'expired' || session.payment_status === 'unpaid') {
          console.log(`Cleaning up expired/unpaid session ${sessionData.sessionId}`);
          await removePendingSession(sessionData.sessionId);
        } else {
          console.log(`Resuming polling for pending session ${sessionData.sessionId}`);
          pollAndFulfillSession(sessionData.sessionId, sessionData.token, sessionData.tokenAmount).catch(err => {
            console.error(`Error resuming session ${sessionData.sessionId}:`, err);
          });
        }
      } catch (error) {
        console.error(`Failed to check session ${sessionData.sessionId} with Stripe, cleaning up:`, error);
        await removePendingSession(sessionData.sessionId);
      }
    }
  } catch (error) {
    console.error('Failed to recover pending sessions:', error);
  }
}

export const get = async (accessToken: string): Promise<RampData> => {
  try {
    const response = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", contractAddress)
    );

    const ramp = response.data;
    const oracleResponse = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", ramp.priceOracle)
    );

    return { listings: ramp.listings, oracle: oracleResponse.data };
  } catch (error) {
    console.error("Error fetching ramp data:", error);
    throw error;
  }
};

export async function checkout(
  token: string,
  buyerAddress: string,
  amount: string,
  baseUrl: string
): Promise<{ sessionId: string; url: string }> {
  if (!token || !buyerAddress || !baseUrl) {
    throw new Error('Missing required parameters');
  }

  try {
    const accessToken = await getServiceToken();
    const ramp = await get(accessToken);
    
    const listing = ramp.listings[token];
    if (!listing) {
      throw new Error(`Listing ${token} not found`);
    }

    if (!canLockAmount(token, amount, listing.amount)) {
      throw new Error(`Amount ${amount} is currently being processed by another user`);
    }

    const price = ramp.oracle?.prices[listing.token];
    if (!price) {
      throw new Error(`Price not found for token ${listing.token}`);
    }

    const totalAmount = calculatePaymentAmount(amount, price, listing.marginBps);
    const { sessionId, url } = await createCheckoutSession({
      token,
      amount: totalAmount,
      tokenAmount: amount,
      tokenAddress: listing.token,
      buyerAddress,
      baseUrl
    });

    // Save session to database for persistent idempotency tracking
    await savePendingSession(sessionId, token, buyerAddress, amount);
    
    try {
      addLock(token, amount, sessionId);
      
      pollAndFulfillSession(sessionId, token, amount).catch(err => {
        console.error(`Error in background fulfillment for session ${sessionId}:`, err);
      });
      
      return { sessionId, url };
    } catch (error) {
      // Clean up database if something fails after session creation
      await removePendingSession(sessionId);
      throw error;
    }
  } catch (error) {
    removeLock(token, amount);
    throw error;
  }
}

async function pollAndFulfillSession(sessionId: string, token: string, tokenAmount: string): Promise<void> {
  // Check if session is already being processed in this instance
  if (processingInProgress.has(sessionId)) {
    return;
  }

  // Check if session has already been processed (database check)
  if (!(await isPendingSession(sessionId))) {
    return; // Session was already processed and removed from database
  }

  const maxAttempts = 60; // Poll for up to 10 minutes
  const pollInterval = 10000; // 10 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      // Re-check if session is still pending (another process might have completed it)
      if (!(await isPendingSession(sessionId))) {
        return;
      }
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status === 'paid') {
        // Use idempotency protection for fulfillment
        if (!processingInProgress.has(sessionId)) {
          processingInProgress.add(sessionId);
          try {
            await handleSessionFulfillment(session);
          } catch (error) {
            console.error(`Failed to fulfill session ${sessionId}:`, error);
          } finally {
            processingInProgress.delete(sessionId);
          }
        }
        return;
      } else if (session.payment_status === 'unpaid' && session.status === 'expired') {
        // Remove expired session from database and unlock
        await removePendingSession(sessionId);
        removeLock(token, tokenAmount, sessionId);
        return;
      }
      
    } catch (error) {
      console.error(`Error polling session ${sessionId}:`, error);
      if (attempt === maxAttempts - 1) {
        // Remove failed session from database and unlock
        await removePendingSession(sessionId);
        removeLock(token, tokenAmount, sessionId);
      }
    }
  }
}

async function handleSessionFulfillment(session: Stripe.Checkout.Session): Promise<void> {
  const token = session.metadata?.token;
  const buyerAddress = session.metadata?.buyerAddress;
  const tokenAmount = session.metadata?.tokenAmount;
  const sessionId = session.id;
  
  if (!token || !buyerAddress || !tokenAmount) {
    console.error("Missing required metadata in session", sessionId);
    removeLock(token || '', tokenAmount || '', sessionId);
    throw new Error("Missing required metadata");
  }

  if (session.payment_status !== 'paid') {
    throw new Error(`Session ${sessionId} payment status is not 'paid': ${session.payment_status}`);
  }

  try {
    const accessToken = await getServiceToken();
    const fulfillTx = buildFunctionTx({
      contractName: OnRamp,
      contractAddress,
      method: "fulfillListing",
      args: { token, buyer: buyerAddress, amount: tokenAmount },
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, fulfillTx)
    );

    if (status === "Success") {
      console.log(`Order ${token} confirmed on-chain: ${hash} for session ${sessionId}`);
      // Remove session from database after successful fulfillment
      await removePendingSession(sessionId);
    } else {
      throw new Error(`On-chain confirmation failed (${status}): ${hash}`);
    }
  } finally {
    removeLock(token, tokenAmount, sessionId);
  }
}

// export async function handleStripeWebhook(session: Stripe.Checkout.Session): Promise<void> {
//   const sessionId = session.id;
  
//   // Check idempotency - prevent webhook replay attacks and already processed sessions
//   if (processingInProgress.has(sessionId) || !(await isPendingSession(sessionId))) {
//     return;
//   }

//   // Only process if payment is completed
//   if (session.payment_status !== 'paid') {
//     return;
//   }

//   processingInProgress.add(sessionId);
//   try {
//     await handleSessionFulfillment(session);
//   } catch (error) {
//     console.error(`Webhook processing failed for session ${sessionId}:`, error);
//   } finally {
//     processingInProgress.delete(sessionId);
//   }
// }