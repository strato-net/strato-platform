import Stripe from "stripe";
import { stripeSecretKey } from "../config/config";

// Initialize Stripe client using secret key from env and specify API version
export const stripe = new Stripe(stripeSecretKey || "");

interface CheckoutSessionParams {
  listingId: string;
  amount: number;
  tokenAddress: string;
  buyerAddress: string;
  baseUrl: string;
}

export async function createCheckoutSession({
  listingId,
  amount,
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
            name: `Token Purchase - Order ${listingId}`,
            description: `Purchase of locked tokens for order ${listingId}`,
          },
          unit_amount: amount,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    metadata: {
      listingId,
      tokenAddress,
      buyerAddress,
      amount: amount.toString(),
    },
    success_url: `${baseUrl}/dashboard?listingId=${listingId}&success=true`,
    cancel_url: `${baseUrl}/dashboard?listingId=${listingId}&success=false`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
  });

  return {
    sessionId: session.id,
    url: session.url!,
  };
}
