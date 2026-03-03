import Stripe from "stripe";
import axios from "axios";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { getServiceToken } from "../../utils/authHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { openIdTokenEndpoint } from "../../config/config";

const { MercataBridge, mercataBridge } = constants;

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
// Bridge deposit constants
// ————————————————————————————————————————————————————————————————

const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

const EXTERNAL_TOKEN: Record<string, string> = {
  eth: ZERO_ADDRESS,
  usdc: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
};

const EXTERNAL_DECIMALS: Record<string, number> = {
  eth: 18,
  usdc: 6,
};

const BRIDGE_CHAIN_ID: Record<string, number> = {
  ethereum: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? 11155111 : 1,
  base: process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ? 84532 : 8453,
};

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
// Bridge admin token (Resource Owner Password Credentials grant)
// ————————————————————————————————————————————————————————————————

let cachedBridgeToken: { token: string; expiresAt: number } | null = null;

async function getBridgeAdminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedBridgeToken && cachedBridgeToken.expiresAt > now + 30) {
    return cachedBridgeToken.token;
  }

  const username = process.env.BA_USERNAME;
  const password = process.env.BA_PASSWORD;
  if (!username || !password) {
    throw new Error("BA_USERNAME and BA_PASSWORD must be configured for bridge deposits");
  }
  if (!openIdTokenEndpoint) {
    throw new Error("OpenID token endpoint not initialized");
  }

  const response = await axios.post(
    openIdTokenEndpoint,
    new URLSearchParams({
      grant_type: "password",
      username,
      password,
      client_id: process.env.OAUTH_CLIENT_ID || "",
      client_secret: process.env.OAUTH_CLIENT_SECRET || "",
      scope: "openid email profile",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const { access_token, expires_in } = response.data;
  if (!access_token) throw new Error("No access token returned from ROPC grant");

  cachedBridgeToken = {
    token: access_token,
    expiresAt: now + (expires_in || 300),
  };

  return access_token;
}

// ————————————————————————————————————————————————————————————————
// MercataBridge deposit (Step 1 of 2 — bridge service confirms)
// ————————————————————————————————————————————————————————————————

function toRawAmount(humanAmount: string, decimals: number): string {
  const [whole = "0", frac = ""] = humanAmount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac).toString();
}

async function depositOnStrato(
  externalChainId: number,
  externalSender: string,
  externalToken: string,
  externalTokenAmount: string,
  externalTxHash: string,
  stratoRecipient: string,
): Promise<void> {
  const accessToken = await getBridgeAdminToken();

  const tx = await buildFunctionTx({
    contractName: extractContractName(MercataBridge),
    contractAddress: mercataBridge,
    method: "deposit",
    args: {
      externalChainId,
      externalSender,
      externalToken,
      externalTokenAmount,
      externalTxHash,
      stratoRecipient,
    },
  });

  console.log(
    `[Onramp] Calling deposit — chainId=${externalChainId}, token=${externalToken}, ` +
    `amount=${externalTokenAmount}, txHash=${externalTxHash}, recipient=${stratoRecipient}`
  );

  await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  console.log(`[Onramp] deposit succeeded — bridge service will verify and confirm`);
}

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

export async function handleSessionUpdate(sessionData: any): Promise<void> {
  const stripeSessionId: string = sessionData.id;
  const status: string = sessionData.status;
  const userAddress: string | undefined = sessionData.metadata?.strato_user_address;
  const txDetails = sessionData.transaction_details;

  if (!userAddress) {
    console.warn(`[Onramp] Webhook for session ${stripeSessionId} — no strato_user_address in metadata`);
    return;
  }

  if (status === "fulfillment_complete") {
    const currency: string | undefined = txDetails?.destination_currency;
    const network: string | undefined = txDetails?.destination_network;
    const amount: string | undefined = txDetails?.destination_amount;
    const txHash: string | undefined = txDetails?.transaction_id;
    const walletAddress: string | undefined = txDetails?.wallet_address;

    console.log(
      `[Onramp] Fulfillment complete — session=${stripeSessionId}, ` +
      `user=${userAddress}, currency=${currency}, network=${network}, ` +
      `amount=${amount}, txHash=${txHash}`
    );

    if (!txHash || !network || !currency || !amount) {
      console.error(`[Onramp] Missing transaction details in fulfillment_complete webhook`);
      return;
    }

    const externalToken = EXTERNAL_TOKEN[currency];
    const decimals = EXTERNAL_DECIMALS[currency];
    const chainId = BRIDGE_CHAIN_ID[network];

    if (externalToken === undefined || decimals === undefined || chainId === undefined) {
      console.error(`[Onramp] Unsupported currency=${currency} or network=${network}`);
      return;
    }

    const externalTokenAmount = toRawAmount(amount, decimals);
    const hotWallet = process.env.ONRAMP_HOT_WALLET_ADDRESS;
    if (!hotWallet) {
      console.error(`[Onramp] ONRAMP_HOT_WALLET_ADDRESS not configured — cannot deposit`);
      return;
    }
    const externalSender = hotWallet.replace(/^0x/, "");

    try {
      await depositOnStrato(
        chainId,
        externalSender,
        externalToken,
        externalTokenAmount,
        txHash,
        userAddress,
      );
    } catch (err: any) {
      if (err.message?.includes("MB: duplicate deposit")) {
        console.log(`[Onramp] Deposit already recorded for txHash=${txHash} — skipping`);
      } else {
        console.error(`[Onramp] depositBatch FAILED — ${err.message}`);
      }
    }
  } else {
    console.log(`[Onramp] Session ${stripeSessionId} → ${status} (user=${userAddress})`);
  }
}

export async function getDepositStatus(accessToken: string, externalTxHash: string): Promise<{ status: "pending" | "initiated" | "completed" }> {

  const { data: completed } = await cirrus.get(accessToken, `/${MercataBridge}-DepositCompleted`, {
    params: { externalTxHash: `eq.${externalTxHash}`, limit: "1" },
  });
  if (completed?.length > 0) return { status: "completed" };

  const { data: initiated } = await cirrus.get(accessToken, `/${MercataBridge}-DepositInitiated`, {
    params: { externalTxHash: `eq.${externalTxHash}`, limit: "1" },
  });
  if (initiated?.length > 0) return { status: "initiated" };

  return { status: "pending" };
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
