import { strato, bloc } from "../../utils/mercataApiHelper";
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
  listingId: string,
  buyerAddress: string,
  amount: string,
  baseUrl: string
): Promise<{ sessionId: string; url: string }> {
  if (!listingId || !buyerAddress || !baseUrl) {
    throw new Error('Missing required parameters');
  }

  try {
    const token = await getServiceToken();
    const ramp = await get(token);
    
    const listing = ramp.listings[listingId];
    if (!listing) {
      throw new Error(`Listing ${listingId} not found`);
    }

    if (!canLockAmount(listingId, amount, listing.amount)) {
      throw new Error(`Amount ${amount} is currently being processed by another user`);
    }

    const price = ramp.oracle?.prices[listing.token];
    if (!price) {
      throw new Error(`Price not found for token ${listing.token}`);
    }

    const totalAmount = calculatePaymentAmount(amount, price, listing.marginBps);
    const { sessionId, url } = await createCheckoutSession({
      listingId,
      amount: totalAmount,
      tokenAmount: amount,
      tokenAddress: listing.token,
      buyerAddress,
      baseUrl
    });

    addLock(listingId, amount, sessionId);
    return { sessionId, url };
  } catch (error) {
    removeLock(listingId, amount);
    throw error;
  }
}

export async function handleStripeWebhook(session: Stripe.Checkout.Session): Promise<void> {
  const listingId = session.metadata?.listingId;
  const buyerAddress = session.metadata?.buyerAddress;
  const amount = session.metadata?.amount;
  const tokenAmount = session.metadata?.tokenAmount;
  const stripeSessionId = session.id;
  
  if (!listingId || !buyerAddress || !amount || !tokenAmount) {
    console.error("Missing required metadata in session");
    removeLock(listingId || '', tokenAmount || '', stripeSessionId);
    return;
  }

  try {
    const token = await getServiceToken();
    const { status, hash } = await postAndWaitForTx(token, () =>
      strato.post(token, StratoPaths.transactionParallel, buildFunctionTx({
        contractName: OnRamp,
        contractAddress,
        method: "fulfillListing",
        args: { listingId, buyer: buyerAddress, amount: tokenAmount },
      }))
    );

    if (status === "Success") {
      console.log(`Order ${listingId} confirmed on-chain: ${hash}`);
    } else {
      console.error(`On-chain confirmation failed (${status}): ${hash}`);
    }
  } catch (err) {
    console.error("Error confirming order on-chain:", err);
  } finally {
    removeLock(listingId, tokenAmount, stripeSessionId);
  }
}
