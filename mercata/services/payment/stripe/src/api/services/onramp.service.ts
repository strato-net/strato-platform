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
  const tokenMeta = session.metadata?.token;
  const buyerAddress = session.metadata?.buyerAddress;
  const amount = session.metadata?.amount;
  const tokenAmount = session.metadata?.tokenAmount;
  const stripeSessionId = session.id;

  if (!tokenMeta || !buyerAddress || !amount || !tokenAmount) {
    console.error("Missing required metadata in session");
    removeLock(tokenMeta ?? '', tokenAmount ?? '', stripeSessionId);
    return;
  }

  try {

    const accessToken = await getServiceToken();
    const tokenAddress: string = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010";

    console.log(`Processing payment for token ${tokenAddress}, buyer ${buyerAddress}, amount ${tokenAmount}`);

    const fulfillTx = buildFunctionTx({
      contractName: OnRamp,
      contractAddress,
      method: "fulfillListing",
      args: { token: tokenAddress, buyer: buyerAddress, amount: tokenAmount },
    });

    console.log("Submitting fulfillListing…");
    const { status: st2, hash: hash2 } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, fulfillTx)
    );

    if (st2 === "Success") {
      console.log(`Order ${tokenAddress} confirmed on-chain: ${hash2}`);

      const voucherContractAddress = process.env.VOUCHER_CONTRACT_ADDRESS || "A96c02a13b558fbcf923af1d586967cf7f55c753"; // TODO: move to config

      const mintTx = buildFunctionTx({
        contractName: "Voucher",
        contractAddress: voucherContractAddress,
        method: "mint",
        args: {
          to: buyerAddress,
          amount: (1000000000000000000).toString(), // 1 voucher (18 decimals)
        },
      });

      console.log("Submitting Voucher.mint…");
      const { status: st3, hash: hash3 } = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, mintTx)
      );

      if (st3 === "Success") {
        console.log(`Voucher minted: ${hash3}`);
      } else {
        console.error(`Voucher mint failed (${st3}): ${hash3}`);
      }
    } else {
      console.error(`On-chain confirmation failed (${st2}): ${hash2}`);
    }
  } catch (err) {
    console.error("Error confirming order on-chain:", err);
  } finally {
    removeLock(tokenMeta ?? '', tokenAmount ?? '', stripeSessionId);
  }
}

export async function mintVouchers(sessionId: string): Promise<void> {
  const MAX_ATTEMPTS = 6;
  const DELAY_MS = 5_000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid" && session.status === "complete") {
      await handleStripeWebhook(session as unknown as Stripe.Checkout.Session);
      return;
    }

    console.log(
      `Session ${sessionId} not complete yet (attempt ${attempt}/${MAX_ATTEMPTS}) – ` +
      `status=${session.status}, payment_status=${session.payment_status}`
    );

    if (attempt < MAX_ATTEMPTS) {
      await new Promise(res => setTimeout(res, DELAY_MS));
    } else {
      throw new Error(
        `Session ${sessionId} did not reach paid/complete after ${MAX_ATTEMPTS} attempts`
      );
    }
  }
}
