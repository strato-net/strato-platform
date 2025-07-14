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
const voucherAddress = constants.voucher!;
const OnRamp = "OnRamp";
const Voucher = "Voucher";

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
    return { sessionId, url };
  } catch (error) {
    removeLock(token, amount);
    throw error;
  }
}

export async function handleStripeWebhook(session: Stripe.Checkout.Session): Promise<void> {
  const token = session.metadata?.token;
  const buyerAddress = session.metadata?.buyerAddress;
  const amount = session.metadata?.amount;
  const tokenAmount = session.metadata?.tokenAmount;
  const stripeSessionId = session.id;
  // console.log("HIT WEBHOOK ------------------------------")
  
  if (!token || !buyerAddress || !amount || !tokenAmount) {
    console.error("Missing required metadata in session");
    removeLock(token || '', tokenAmount || '', stripeSessionId);
    return;
  }

  try {
    const accessToken = await getServiceToken();
    const fulfillTx = buildFunctionTx({
      contractName: OnRamp,
      contractAddress,
      method: "fulfillListing",
      args: { token, buyer: buyerAddress, amount: tokenAmount },
    });
    // Set large gas params if more lucrative tx problem persists
    // fulfillTx.txParams.gasLimit = 999999999999999;
    // fulfillTx.txParams.gasPrice = 1000000000;

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, fulfillTx)
    );

    if (status === "Success") {
      console.log(`Order ${token} confirmed on-chain: ${hash}`);
    } else {
      console.error(`On-chain confirmation failed (${status}): ${hash}`);
    }
  } catch (err) {
    console.error("Error confirming order on-chain:", err);
  } finally {
    removeLock(token, tokenAmount, stripeSessionId);
  }

  try {
    const accessToken = await getServiceToken();
    const {status, hash} = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, buildFunctionTx({
        contractName: Voucher,
        contractAddress: voucherAddress,
        method: "mint",
        args: { to: buyerAddress, amount: 10000000000000000000 },
      }))
    );
    if (status === "Success") {
      console.log(`10 Vouchers minted: ${hash}`);
    } else {
      console.error(`Voucher mint failed (${status}): ${hash}`);
    }
  } catch (err) {
    console.error("Error minting vouchers:", err);
  }

}