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
  
  if (!token || !buyerAddress || !amount || !tokenAmount) {
    console.error("Missing required metadata in session");
    removeLock(token || '', tokenAmount || '', stripeSessionId);
    return;
  }

  try {
    console.log("--------- handleStripeWebhook ---------");
    console.log(`Processing payment for token ${token}, buyer ${buyerAddress}, amount ${tokenAmount}`);

    // HACK: Add random delay to avoid nonce conflicts
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 500)); // 500-2500ms delay

    const accessToken = await getServiceToken();
    
    // TESTING: Only mint voucher tokens for now (fulfillListing commented out)
    // const tokenAddress = "937efa7e3a77e20bbdbd7c0d32b6514f368c1010"; // USDST address
    // const fulfillTx = buildFunctionTx({
    //   contractName: OnRamp,
    //   contractAddress,
    //   method: "fulfillListing",
    //   args: { token: tokenAddress, buyer: buyerAddress, amount: tokenAmount },
    // });

    const voucherTx = buildFunctionTx({
      contractName: "Voucher",
      contractAddress: "A96c02a13b558fbcf923af1d586967cf7f55c753",
      method: "mint",
      args: { 
        to: buyerAddress,
        amount: (10n ** 18n).toString() // 10^18 units
      },
    });

    // Only voucher minting for now
    // HACK: Add timestamp + random gas price to avoid nonce conflicts
    const timestamp = Date.now() % 10000; // last 4 digits of timestamp
    const randomGasPrice = timestamp + Math.floor(Math.random() * 1000) + 10000; // 10000+ range
    const combinedTx = {
      txs: [...voucherTx.txs],
      txParams: {
        ...voucherTx.txParams,
        gasPrice: randomGasPrice
      },
    };

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, combinedTx)
    );

    if (status === "Success") {
      console.log(`PAYMENT SUCCESSFUL - Order ${token} confirmed on-chain: ${hash}`);
    } else {
      console.error(`Payment processing failed (${status}): ${hash}`);
    }
  } catch (err) {
    console.error("Error confirming order on-chain:", err);
  } finally {
    removeLock(token, tokenAmount, stripeSessionId);
  }
}
