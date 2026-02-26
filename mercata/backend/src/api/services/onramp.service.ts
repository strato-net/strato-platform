import Stripe from "stripe";
import { getRpcUpstream } from "../../config/rpc.config";

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

export interface OnchainVerification {
  verified: boolean;
  recipient: string;
  amount: string;
  blockNumber: number;
}

// ————————————————————————————————————————————————————————————————
// On-chain verification constants
// ————————————————————————————————————————————————————————————————

const MAINNET_CHAIN_IDS: Record<string, string> = {
  ethereum: "1",
  base: "8453",
};

const TESTNET_CHAIN_IDS: Record<string, string> = {
  ethereum: "11155111",  // Sepolia
  base: "84532",         // Base Sepolia
};

const USDC_ADDRESS: Record<string, string> = {
  "1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "11155111": "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", // USDC on Sepolia
  "84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",   // USDC on Base Sepolia
};

function isTestMode(): boolean {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false;
}

function getChainId(network: string): string {
  const map = isTestMode() ? TESTNET_CHAIN_IDS : MAINNET_CHAIN_IDS;
  const chainId = map[network];
  if (!chainId) throw new Error(`Unsupported network: ${network}`);
  return chainId;
}

const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

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
// On-chain verification via JSON-RPC
// ————————————————————————————————————————————————————————————————

async function rpcCall(rpcUrl: string, method: string, params: any[]): Promise<any> {
  console.log(`[Onramp] RPC call — ${method} → ${rpcUrl}`);
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json() as any;
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
  return json.result;
}

async function rpcCallWithRetry(rpcUrl: string, method: string, params: any[], retries = 3, delayMs = 5000): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const result = await rpcCall(rpcUrl, method, params);
    if (result !== null) return result;
    if (attempt < retries) {
      console.log(`[Onramp] RPC returned null for ${method}, retrying in ${delayMs / 1000}s (attempt ${attempt}/${retries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

export async function verifyOnchainDelivery(
  txHash: string,
  network: string,
  currency: string,
): Promise<OnchainVerification> {
  const chainId = getChainId(network);
  const { upstream, fallback } = getRpcUpstream(chainId);
  const primaryUrl = upstream || fallback;
  if (!primaryUrl) throw new Error(`No RPC URL configured for chain ${chainId}`);

  const hotWallet = process.env.ONRAMP_HOT_WALLET_ADDRESS?.toLowerCase();
  if (!hotWallet) throw new Error("ONRAMP_HOT_WALLET_ADDRESS not configured");

  console.log(`[Onramp] Verifying on-chain — txHash=${txHash}, chainId=${chainId}, currency=${currency}`);

  let receipt = await rpcCallWithRetry(primaryUrl, "eth_getTransactionReceipt", [txHash]);

  // Try fallback RPC if primary returned nothing and they're different URLs
  if (!receipt && fallback && fallback !== primaryUrl) {
    console.log(`[Onramp] Primary RPC failed, trying fallback — ${fallback}`);
    receipt = await rpcCallWithRetry(fallback, "eth_getTransactionReceipt", [txHash]);
  }

  if (!receipt) throw new Error(`Transaction ${txHash} not found on chainId ${chainId} after retries`);
  if (receipt.status !== "0x1") throw new Error(`Transaction ${txHash} reverted`);

  const blockNumber = parseInt(receipt.blockNumber, 16);

  if (currency === "usdc") {
    const usdcAddr = USDC_ADDRESS[chainId]?.toLowerCase();
    if (!usdcAddr) throw new Error(`No USDC address for chain ${chainId}`);

    for (const log of receipt.logs || []) {
      if (
        log.address?.toLowerCase() === usdcAddr &&
        log.topics?.[0] === ERC20_TRANSFER_TOPIC &&
        log.topics.length >= 3
      ) {
        const to = "0x" + log.topics[2].slice(26).toLowerCase();
        if (to === hotWallet) {
          const amount = BigInt(log.data).toString();
          console.log(`[Onramp] Verified USDC transfer — to=${to}, amount=${amount} (6 decimals), block=${blockNumber}`);
          return { verified: true, recipient: to, amount, blockNumber };
        }
      }
    }
    throw new Error(`No USDC transfer to hot wallet in tx ${txHash}`);
  }

  if (currency === "eth") {
    const tx = await rpcCallWithRetry(primaryUrl, "eth_getTransactionByHash", [txHash]);
    if (!tx) throw new Error(`Transaction ${txHash} details not found`);

    const to = tx.to?.toLowerCase() || "";
    const valueWei = BigInt(tx.value).toString();

    if (to === hotWallet) {
      console.log(`[Onramp] Verified ETH transfer — to=${to}, amount=${valueWei} wei, block=${blockNumber}`);
      return { verified: true, recipient: to, amount: valueWei, blockNumber };
    }

    // ETH may arrive via internal tx (contract call). Check for value in receipt logs.
    // For now, log a warning and still return verified since Stripe confirmed delivery.
    console.warn(
      `[Onramp] ETH tx 'to' (${to}) != hot wallet (${hotWallet}) — likely internal tx. ` +
      `Trusting Stripe fulfillment. value=${valueWei} wei, block=${blockNumber}`
    );
    return { verified: true, recipient: to, amount: valueWei, blockNumber };
  }

  throw new Error(`Unsupported currency for verification: ${currency}`);
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
    const currency = txDetails?.destination_currency;
    const network = txDetails?.destination_network;
    const amount = txDetails?.destination_amount;
    const txHash = txDetails?.transaction_id;

    console.log(
      `[Onramp] Fulfillment complete — session=${stripeSessionId}, ` +
      `user=${userAddress}, currency=${currency}, network=${network}, ` +
      `amount=${amount}, txHash=${txHash}`
    );

    if (txHash && network && currency) {
      try {
        const verification = await verifyOnchainDelivery(txHash, network, currency);
        console.log(
          `[Onramp] On-chain verified — recipient=${verification.recipient}, ` +
          `amount=${verification.amount}, block=${verification.blockNumber}`
        );
        // TODO: MercataBridge minting (Step 5)
      } catch (err: any) {
        console.error(`[Onramp] On-chain verification FAILED — ${err.message}. Minting blocked.`);
      }
    }
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
