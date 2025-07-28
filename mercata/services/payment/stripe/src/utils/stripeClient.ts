import Stripe from "stripe";
import { stripeSecretKey } from "../config/config";
import { CheckoutSessionParams } from "../types/types";

// Initialize Stripe client using secret key from env and specify API version
export const stripe = new Stripe(stripeSecretKey || "");

export async function createCheckoutSession({
  token,
  tokenSymbol,
  amount,
  tokenAmount,
  tokenAddress,
  buyerAddress,
  baseUrl,
}: CheckoutSessionParams): Promise<{ sessionId: string; url: string }> {
  // Create a Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Token Purchase - ${tokenSymbol}`,
            description: `Purchase of ${tokenSymbol} tokens to be used on BlockApps Mercata Testnet.`,
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    metadata: {
      token,
      tokenAddress,
      buyerAddress,
      amount: amount.toString(),
      tokenAmount,
    },
    success_url: `${baseUrl}/dashboard?success=true`,
    cancel_url: `${baseUrl}/dashboard?success=false`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
  });

  return {
    sessionId: session.id,
    url: session.url!,
  };
}
