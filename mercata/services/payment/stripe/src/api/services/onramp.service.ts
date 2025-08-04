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

const contractAddress = constants.onRamp!;
const OnRamp = "OnRamp";

// Idempotency tracking - in production, use Redis/DB
const processedSessions = new Set<string>();
const processingInProgress = new Set<string>();

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

    addLock(token, amount, sessionId);
    
    pollAndFulfillSession(sessionId, token, amount).catch(err => {
      console.error(`Error in background fulfillment for session ${sessionId}:`, err);
    });
    
    return { sessionId, url };
  } catch (error) {
    removeLock(token, amount);
    throw error;
  }
}

async function pollAndFulfillSession(sessionId: string, token: string, tokenAmount: string): Promise<void> {
  if (processedSessions.has(sessionId) || processingInProgress.has(sessionId)) {
    return;
  }

  const maxAttempts = 126; // Poll for up to 21 minutes
  const pollInterval = 10000; // 10 seconds
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      if (processedSessions.has(sessionId)) {
        return;
      }
      
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status === 'paid') {
        // Use idempotency protection for fulfillment
        if (!processedSessions.has(sessionId) && !processingInProgress.has(sessionId)) {
          processingInProgress.add(sessionId);
          try {
            await handleSessionFulfillment(session);
            processedSessions.add(sessionId);
          } catch (error) {
            console.error(`Failed to fulfill session ${sessionId}:`, error);
          } finally {
            processingInProgress.delete(sessionId);
          }
        }
        return;
      } else if (session.payment_status === 'unpaid' && session.status === 'expired') {
        removeLock(token, tokenAmount, sessionId);
        return;
      }
      
    } catch (error) {
      console.error(`Error polling session ${sessionId}:`, error);
      if (attempt === maxAttempts - 1) {
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
    } else {
      throw new Error(`On-chain confirmation failed (${status}): ${hash}`);
    }
  } finally {
    removeLock(token, tokenAmount, sessionId);
  }
}

// export async function handleStripeWebhook(session: Stripe.Checkout.Session): Promise<void> {
//   const sessionId = session.id;
  
//   // Check idempotency - prevent webhook replay attacks
//   if (processedSessions.has(sessionId) || processingInProgress.has(sessionId)) {
//     return;
//   }

//   // Only process if payment is completed
//   if (session.payment_status !== 'paid') {
//     return;
//   }

//   processingInProgress.add(sessionId);
//   try {
//     await handleSessionFulfillment(session);
//     processedSessions.add(sessionId);
//   } catch (error) {
//     console.error(`Webhook processing failed for session ${sessionId}:`, error);
//   } finally {
//     processingInProgress.delete(sessionId);
//   }
// }