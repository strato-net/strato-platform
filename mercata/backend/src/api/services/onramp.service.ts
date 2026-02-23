import Stripe from "stripe";

// ————————————————————————————————————————————————————————————————
// Types
// ————————————————————————————————————————————————————————————————

export interface OnrampSession {
  stripeSessionId: string;
  userStratoAddress: string;
  status: string;
  createdAt: Date;
  completedAt?: Date;
  destinationCurrency?: string;
  destinationNetwork?: string;
  destinationAmount?: string;
  externalTxHash?: string;
}

// ————————————————————————————————————————————————————————————————
// In-memory session store (Should be replaced with a database )
// ————————————————————————————————————————————————————————————————

const sessionStore = new Map<string, OnrampSession>();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const StripeResourceClass = (Stripe as any).StripeResource;
const OnrampSessionResource = StripeResourceClass.extend({
  create: StripeResourceClass.method({
    method: "POST",
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
  });

  sessionStore.set(onrampSession.id, {
    stripeSessionId: onrampSession.id,
    userStratoAddress,
    status: "initialized",
    createdAt: new Date(),
  });

  console.log(`[Onramp] Session created — stripeId=${onrampSession.id}, storeSize=${sessionStore.size}`);
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
  const txDetails = sessionData.transaction_details;

  const session = sessionStore.get(stripeSessionId);
  if (!session) {
    console.warn(`[Onramp] Webhook received for unknown session: ${stripeSessionId}`);
    return;
  }

  session.status = status;
  if (txDetails) {
    session.destinationCurrency = txDetails.destination_currency;
    session.destinationNetwork = txDetails.destination_network;
    session.destinationAmount = txDetails.destination_amount;
    session.externalTxHash = txDetails.transaction_id;
  }

  if (status === "fulfillment_complete") {
    session.completedAt = new Date();
    console.log(
      `[Onramp] Fulfillment complete — session=${stripeSessionId}, ` +
      `user=${session.userStratoAddress}, currency=${session.destinationCurrency}, ` +
      `network=${session.destinationNetwork}, amount=${session.destinationAmount}, ` +
      `txHash=${session.externalTxHash}`
    );
    // TODO: On-chain verification + MercataBridge minting (Steps 4 & 5)
  } else {
    console.log(`[Onramp] Session ${stripeSessionId} → ${status}`);
  }
}

export function getUserTransactions(userStratoAddress: string): OnrampSession[] {
  return Array.from(sessionStore.values())
    .filter((s) => s.userStratoAddress === userStratoAddress)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
