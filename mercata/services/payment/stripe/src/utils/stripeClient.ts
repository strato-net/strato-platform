import Stripe from "stripe";
import { stripeSecretKey } from "../config/config";
import { CheckoutSessionParams } from "../types/types";
import { cirrus } from "./mercataApiHelper";
import { getServiceToken } from "./authHelper";

// Initialize Stripe client using secret key from env and specify API version
export const stripe = new Stripe(stripeSecretKey || "");

// Helper function to fetch token symbol from Cirrus
async function getTokenSymbol(tokenAddress: string): Promise<string> {
  try {
    const accessToken = await getServiceToken();
    const { data: tokenData } = await cirrus.get(accessToken, "/BlockApps-Mercata-Token", {
      params: {
        address: `eq.${tokenAddress}`,
        select: "_symbol",
      },
    });

    if (tokenData && tokenData.length > 0 && tokenData[0]._symbol) {
      return tokenData[0]._symbol;
    }
    
    return "<Token Symbol Unavailable>";
  } catch (error) {
    console.error("Error fetching token symbol:", error);
    return "<Token Symbol Unavailable>";
  }
}

export async function createCheckoutSession({
  token,
  amount,
  tokenAmount,
  tokenAddress,
  buyerAddress,
  baseUrl,
}: CheckoutSessionParams): Promise<{ sessionId: string; url: string }> {
  // Fetch token symbol from Cirrus
  const tokenSymbol = await getTokenSymbol(tokenAddress);
  
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
