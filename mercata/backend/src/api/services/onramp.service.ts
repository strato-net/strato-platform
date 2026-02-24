import Stripe from "stripe";

// ————————————————————————————————————————————————————————————————
// Types
// ————————————————————————————————————————————————————————————————

export interface OnrampTransaction {
  stripeSessionId: string;
  status: string;
  createdAt: string;
  destinationCurrency?: string;
  destinationNetwork?: string;
  destinationAmount?: string;
}

// ————————————————————————————————————————————————————————————————
// Stripe SDK setup
// ————————————————————————————————————————————————————————————————

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const StripeResourceClass = (Stripe as any).StripeResource;
const OnrampSessionResource = StripeResourceClass.extend({
  create: StripeResourceClass.method({
    method: "POST",
    path: "crypto/onramp_sessions",
  }),
  list: StripeResourceClass.method({
    method: "GET",
    path: "crypto/onramp_sessions",
  }),
});

// ————————————————————————————————————————————————————————————————
// Service functions
// ————————————————————————————————————————————————————————————————

export async function createOnrampSession(
  userStratoAddress: string,
  clientIp: string
): Promise<{ clientSecret: string }> {
  const hotWallet = process.env.ONRAMP_HOT_WALLET_ADDRESS;
  if (!hotWallet) {
    throw new Error("ONRAMP_HOT_WALLET_ADDRESS is not configured");
  }

  console.log(`[Onramp] Creating session — user=${userStratoAddress}, ip=${clientIp}`);

  const onrampSession = await new OnrampSessionResource(stripe).create({
    wallet_addresses: {
      ethereum: hotWallet,
    },
    customer_ip_address: clientIp,
    destination_currencies: ["usdc", "eth"],
    destination_networks: ["ethereum"],
    lock_wallet_address: true,
    metadata: {
      strato_user_address: userStratoAddress,
    },
  });

  console.log(`[Onramp] Session created — stripeId=${onrampSession.id}`);
  return { clientSecret: onrampSession.client_secret };
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

export function handleSessionUpdate(sessionData: any): void {
  const stripeSessionId: string = sessionData.id;
  const status: string = sessionData.status;
  const userAddress: string | undefined = sessionData.metadata?.strato_user_address;
  const txDetails = sessionData.transaction_details;

  if (!userAddress) {
    console.warn(`[Onramp] Webhook for session ${stripeSessionId} — no strato_user_address in metadata`);
    return;
  }

  if (status === "fulfillment_complete") {
    console.log(
      `[Onramp] Fulfillment complete — session=${stripeSessionId}, ` +
      `user=${userAddress}, currency=${txDetails?.destination_currency}, ` +
      `network=${txDetails?.destination_network}, amount=${txDetails?.destination_amount}, ` +
      `txHash=${txDetails?.transaction_id}`
    );
    // TODO: On-chain verification + MercataBridge minting (Steps 4 & 5)
  } else {
    console.log(`[Onramp] Session ${stripeSessionId} → ${status} (user=${userAddress})`);
  }
}

export async function getUserTransactions(userStratoAddress: string): Promise<OnrampTransaction[]> {
  const resource = new OnrampSessionResource(stripe);
  const response = await resource.list({ limit: 100 });

  return (response.data as any[])
    .filter((s: any) => s.metadata?.strato_user_address === userStratoAddress)
    .map((s: any) => ({
      stripeSessionId: s.id,
      status: s.status,
      createdAt: new Date(s.created * 1000).toISOString(),
      destinationCurrency: s.transaction_details?.destination_currency,
      destinationNetwork: s.transaction_details?.destination_network,
      destinationAmount: s.transaction_details?.destination_amount,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
