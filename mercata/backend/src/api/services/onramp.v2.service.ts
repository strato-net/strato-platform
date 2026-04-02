import axios from "axios";
import * as crypto from "crypto";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { strato, cirrus } from "../../utils/mercataApiHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { openIdTokenEndpoint } from "../../config/config";
import { getDepositStatus, getUserTransactions } from "./onramp.service";
export { getDepositStatus, getUserTransactions };
export type { OnrampTransaction } from "./onramp.service";

const { MercataBridge, mercataBridge } = constants;

// ————————————————————————————————————————————————————————————————
// Meld API configuration
// ————————————————————————————————————————————————————————————————

const MELD_API_URL = process.env.MELD_API_URL || "https://api.meld.io";
const MELD_API_KEY = process.env.MELD_API_KEY;
const MELD_WEBHOOK_SECRET = process.env.MELD_WEBHOOK_SECRET;
const MELD_WEBHOOK_URL = process.env.MELD_WEBHOOK_URL;
const MELD_VERSION = process.env.MELD_VERSION || "2026-02-03";

export function isOnrampV2Enabled(): boolean {
  return !!MELD_API_KEY;
}

function meldHeaders(): Record<string, string> {
  const key = MELD_API_KEY || "";
  const auth = key.startsWith("BASIC ") ? key : `BASIC ${key}`;
  return {
    Authorization: auth,
    "Content-Type": "application/json",
    "Meld-Version": MELD_VERSION,
  };
}

// ————————————————————————————————————————————————————————————————
// Bridge deposit constants (same token/chain maps as v1)
// ————————————————————————————————————————————————————————————————

const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

const EXTERNAL_TOKEN_BY_CHAIN: Record<number, Record<string, string>> = {
  1: { eth: ZERO_ADDRESS, usdc: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  11155111: { eth: ZERO_ADDRESS, usdc: "94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8" }
};

const TARGET_STRATO_TOKEN: Record<string, string> = {
  eth: "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  usdc: constants.USDST,
};

const EXTERNAL_DECIMALS: Record<string, number> = {
  eth: 18,
  usdc: 6,
};

// ————————————————————————————————————————————————————————————————
// Bridge admin token (ROPC grant — same as v1)
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

  cachedBridgeToken = { token: access_token, expiresAt: now + (expires_in || 300) };
  return access_token;
}

// ————————————————————————————————————————————————————————————————
// Bridge deposit helpers
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
  targetStratoToken: string,
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
      targetStratoToken,
    },
  });

  console.log(
    `[OnrampV2] Calling deposit — chainId=${externalChainId}, token=${externalToken}, ` +
      `amount=${externalTokenAmount}, txHash=${externalTxHash}, recipient=${stratoRecipient}`
  );

  await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, tx)
  );

  console.log(`[OnrampV2] deposit succeeded — bridge service will verify and confirm`);
}

// ————————————————————————————————————————————————————————————————
// Meld currency normalization
// ————————————————————————————————————————————————————————————————

function normalizeMeldCurrency(code: string): string {
  const lower = code.toLowerCase();
  if (lower === "eth" || lower.startsWith("eth_")) return "eth";
  if (lower === "usdc" || lower.startsWith("usdc_")) return "usdc";
  return lower;
}

// ————————————————————————————————————————————————————————————————
// Meld API — Quotes
// ————————————————————————————————————————————————————————————————

export async function getCryptoQuote(
  userStratoAddress: string,
  sourceAmount: string,
  destinationCurrencyCode: string,
): Promise<any> {
  if (!MELD_API_KEY) throw new Error("Meld onramp is not configured on this node");

  const { data } = await axios.post(`${MELD_API_URL}/payments/crypto/quote`, {
    sourceAmount,
    sourceCurrencyCode: "USD",
    destinationCurrencyCode,
    countryCode: "US",
    paymentMethodType: "CREDIT_DEBIT_CARD",
    externalCustomerId: userStratoAddress,
  }, { headers: meldHeaders() });
  console.log(`[OnrampV2] Quote response:`, data);

  return data;
}

// ————————————————————————————————————————————————————————————————
// Meld API — Widget Session
// ————————————————————————————————————————————————————————————————

export async function createWidgetSession(
  userStratoAddress: string,
  sourceAmount: string,
  destinationCurrencyCode: string,
  serviceProvider: string,
): Promise<{ widgetUrl: string }> {
  if (!MELD_API_KEY) throw new Error("Meld onramp is not configured on this node");

  const hotWallet = process.env.ONRAMP_HOT_WALLET_ADDRESS;
  if (!hotWallet) throw new Error("ONRAMP_HOT_WALLET_ADDRESS is not configured");

  const redirectUrl = process.env.MELD_REDIRECT_URL || "";
  const externalSessionId = `strato_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[OnrampV2] Creating session — user=${userStratoAddress}, provider=${serviceProvider}`);

  const { data } = await axios.post(
    `${MELD_API_URL}/crypto/session/widget`,
    {
      sessionData: {
        walletAddress: hotWallet,
        countryCode: "US",
        sourceCurrencyCode: "USD",
        sourceAmount,
        destinationCurrencyCode,
        serviceProvider,
        paymentMethodType: "CREDIT_DEBIT_CARD",
        lockFields: ["walletAddress"],
        ...(redirectUrl ? { redirectUrl } : {}),
      },
      sessionType: "BUY",
      externalCustomerId: userStratoAddress,
      externalSessionId,
    },
    { headers: meldHeaders() }
  );

  console.log(`[OnrampV2] Session created — meldSessionId=${data.id}, externalSessionId=${externalSessionId}`);

  return {
    widgetUrl: data.serviceProviderWidgetUrl || data.widgetUrl,
  };
}

// ————————————————————————————————————————————————————————————————
// Meld webhook verification (HMAC-SHA256)
// ————————————————————————————————————————————————————————————————

export function verifyMeldWebhook(rawBody: string, timestamp: string, signature: string): boolean {
  if (!MELD_WEBHOOK_SECRET || !MELD_WEBHOOK_URL) {
    throw new Error("MELD_WEBHOOK_SECRET and MELD_WEBHOOK_URL must be configured");
  }

  const data = `${timestamp}.${MELD_WEBHOOK_URL}.${rawBody}`;
  const hmac = crypto.createHmac("sha256", MELD_WEBHOOK_SECRET);
  hmac.update(data);
  const computed = hmac.digest("base64url");

  // Meld uses base64url with padding
  const padded = computed + "=".repeat((4 - (computed.length % 4)) % 4);
  return padded === signature || computed === signature;
}

// ————————————————————————————————————————————————————————————————
// Meld webhook handler
// ————————————————————————————————————————————————————————————————

export async function handleMeldTransactionUpdate(event: any): Promise<void> {
  const payload = event.payload;
  const eventType: string = event.eventType;
  const status: string = payload.paymentTransactionStatus;
  const userAddress: string | undefined = payload.externalCustomerId;
  const transactionId: string = payload.paymentTransactionId;

  if (!userAddress) {
    console.warn(`[OnrampV2] Webhook for tx ${transactionId} — no externalCustomerId`);
    return;
  }

  if (eventType === "TRANSACTION_CRYPTO_COMPLETE" && status === "SETTLED") {
    console.log(`[OnrampV2] Transaction settled — tx=${transactionId}, user=${userAddress}`);

    const { data: txData } = await axios.get(
      `${MELD_API_URL}/payments/transactions/${transactionId}`,
      { headers: meldHeaders() }
    );

    const tx = txData.transaction;
    const cryptoDetails = tx.cryptoDetails;
    const rawCurrency: string = tx.destinationCurrencyCode;
    const amount: string = String(tx.destinationAmount);
    const txHash: string | undefined = cryptoDetails?.blockchainTransactionId;
    const chainIdStr: string | undefined = cryptoDetails?.chainId;

    if (!txHash || !rawCurrency || !amount || !chainIdStr) {
      console.error(`[OnrampV2] Missing transaction details in SETTLED webhook — ` +
        `txHash=${txHash}, currency=${rawCurrency}, amount=${amount}, chainId=${chainIdStr}`);
      return;
    }

    const currency = normalizeMeldCurrency(rawCurrency);
    const chainId = parseInt(chainIdStr, 10);
    const externalToken = EXTERNAL_TOKEN_BY_CHAIN[chainId]?.[currency];
    const targetStratoToken = TARGET_STRATO_TOKEN[currency];
    const decimals = EXTERNAL_DECIMALS[currency];

    if (externalToken === undefined || targetStratoToken === undefined || decimals === undefined) {
      console.error(`[OnrampV2] Unsupported currency=${rawCurrency} (normalized=${currency}) or chainId=${chainId}`);
      return;
    }

    const externalTokenAmount = toRawAmount(amount, decimals);
    const hotWallet = (process.env.ONRAMP_HOT_WALLET_ADDRESS || "").replace(/^0x/, "");
    const normalizedTxHash = txHash.replace(/^0x/, "");

    try {
      await depositOnStrato(
        chainId,
        hotWallet,
        externalToken,
        externalTokenAmount,
        normalizedTxHash,
        userAddress,
        targetStratoToken,
      );
    } catch (err: any) {
      if (err.message?.includes("MB: duplicate deposit")) {
        console.log(`[OnrampV2] Deposit already recorded for txHash=${normalizedTxHash} — skipping`);
      } else {
        console.error(`[OnrampV2] deposit FAILED — ${err.message}`);
      }
    }
  } else {
    console.log(`[OnrampV2] Transaction ${transactionId} → ${eventType} / ${status} (user=${userAddress})`);
  }
}
