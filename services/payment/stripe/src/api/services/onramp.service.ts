import { strato, bloc } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { createCheckoutSession } from "../../utils/stripeClient";
import { Stripe } from "stripe";
import { getServiceToken } from "../../utils/authHelper";

const contractAddress = constants.onRamp!;

const OnRamp = "OnRamp";

// Get all tokens with optional filtering
export const get = async (accessToken: string) => {
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
    const oracle = oracleResponse.data;

    return { ...ramp, oracle };
  } catch (error) {
    console.error("Error fetching lending pools:", error);
    throw error;
  }
};

export async function lock(
  listingId: string,
  buyerAddress: string,
  baseUrl: string
): Promise<{ sessionId: string; url: string }> {
  try {
    const token = await getServiceToken();
    const ramp = await get(token);

    if (
      !ramp?.locks?.[listingId]?.[buyerAddress] ||
      !ramp?.listings?.[listingId]
    ) {
      throw new Error(`Order ${listingId} not found`);
    }

    const { token: tokenAddress, marginBps } = ramp.listings[listingId];
    const amount = ramp.locks[listingId][buyerAddress].amount;

    const price = ramp?.oracle?.prices?.[tokenAddress];
    if (!price) {
      throw new Error(`Price not found for token ${tokenAddress}`);
    }

    const amountBigInt = BigInt(amount);
    const priceBigInt = BigInt(price);
    const divisor = BigInt(10 ** 34);
    const marginMultiplier = BigInt(10000 + Number(marginBps));
    const marginDivisor = BigInt(10000);
    // Add a small adjustment before division
    const rawAmount =
      (amountBigInt * priceBigInt * marginMultiplier +
        (divisor * marginDivisor) / 2n) /
      (divisor * marginDivisor);
    const totalAmount = Math.max(Number(rawAmount.toString()), 50);

    const { sessionId, url } = await createCheckoutSession({
      listingId,
      amount: totalAmount,
      tokenAddress,
      buyerAddress,
      baseUrl
    });
    return { sessionId, url };
  } catch (error) {
    console.error("Error in lock function:", error);
    throw error;
  }
}

export async function handleStripeWebhook(
  session: Stripe.Checkout.Session
): Promise<void> {
  const listingId = session.metadata?.listingId;
  const buyerAddress = session.metadata?.buyerAddress;
  if (!listingId) {
    console.error("Missing listingId in session metadata");
    return;
  }
  if (!buyerAddress) {
    console.error("Missing buyerAddress in session metadata");
    return;
  }

  const tx = buildFunctionTx({
    contractName: OnRamp,
    contractAddress,
    method: "fulfillListing",
    args: { listingId, buyer: buyerAddress },
  });

  try {
    const token = await getServiceToken();
    const { status, hash } = await postAndWaitForTx(token, () =>
      strato.post(token, StratoPaths.transactionParallel, tx)
    );

    if (status === "Success") {
      console.log(`Order ${listingId} confirmed on-chain: ${hash}`);
    } else {
      console.error(`On-chain confirmation failed (${status}): ${hash}`);
    }
  } catch (err) {
    console.error("Error confirming order on-chain:", err);
  }
}
