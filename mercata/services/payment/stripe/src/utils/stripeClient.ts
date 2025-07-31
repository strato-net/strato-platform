import Stripe from "stripe";
import { stripeSecretKey } from "../config/config";
import { CheckoutSessionParams } from "../types/types";

// Initialize Stripe client using secret key from env and specify API version
export const stripe = new Stripe(stripeSecretKey || "");

export async function createCheckoutSession({
  token,
  amount,
  tokenAmount,
  tokenAddress,
  buyerAddress,
  baseUrl,
  marginBps,
}: CheckoutSessionParams): Promise<{ sessionId: string; url: string }> {
  // Create a Stripe Checkout Session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Token Purchase - ${token}`,
            description: `Purchase of tokens for order ${token}`,
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
      marginBps,
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
