import axios from "axios";
import * as crypto from "crypto";
import { ethers } from "ethers";

// ————————————————————————————————————————————————————————————————
// Meld API configuration
// ————————————————————————————————————————————————————————————————

const MELD_API_URL = process.env.MELD_API_URL;
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
// Ethereum / DepositRouter configuration
// ————————————————————————————————————————————————————————————————

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const DEPOSIT_ROUTER_ABI = [
  "function deposit(address token, uint256 amount, address stratoAddress, address targetStratoToken, uint256 nonce, uint256 deadline, bytes signature) external",
  "function depositETH(address stratoAddress, address targetStratoToken) external payable",
];

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
];


const TARGET_STRATO_TOKEN: Record<string, string> = {
  eth: "93fb7295859b2d70199e0a4883b7c320cf874e6c",
  usdc: "937efa7e3a77e20bbdbd7c0d32b6514f368c1010",
};

function getChainRpcUrl(chainId: number): string {
  const url = process.env[`CHAIN_${chainId}_RPC_URL`];
  if (!url) throw new Error(`CHAIN_${chainId}_RPC_URL is not configured`);
  return url;
}

function getDepositRouterAddress(): string {
  const addr = process.env.DEPOSIT_ROUTER_ADDRESS;
  if (!addr) throw new Error("DEPOSIT_ROUTER_ADDRESS is not configured");
  return addr;
}

function getSafeSigner(chainId: number): ethers.Wallet {
  const pk = process.env.SAFE_PRIVATE_KEY;
  if (!pk) throw new Error("SAFE_PRIVATE_KEY is not configured");
  const provider = new ethers.JsonRpcProvider(getChainRpcUrl(chainId));
  return new ethers.Wallet(pk, provider);
}

// ————————————————————————————————————————————————————————————————
// Permit2 helpers
// ————————————————————————————————————————————————————————————————

const PERMIT2_TYPES = {
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
};

async function signPermit2(
  signer: ethers.Wallet,
  chainId: number,
  token: string,
  amount: bigint,
  spender: string,
  nonce: bigint,
  deadline: bigint,
): Promise<string> {
  const domain = {
    name: "Permit2",
    chainId,
    verifyingContract: PERMIT2_ADDRESS,
  };

  const message = {
    permitted: { token, amount },
    spender,
    nonce,
    deadline,
  };

  return signer.signTypedData(domain, PERMIT2_TYPES, message);
}

// ————————————————————————————————————————————————————————————————
// DepositRouter call
// ————————————————————————————————————————————————————————————————

async function ensurePermit2Allowance(
  signer: ethers.Wallet,
  tokenAddress: string,
  amount: bigint,
): Promise<void> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const allowance: bigint = await token.allowance(signer.address, PERMIT2_ADDRESS);

  if (allowance >= amount) return;

  console.log(`[OnrampV2] Approving Permit2 for token ${tokenAddress}`);
  const tx = await token.approve(PERMIT2_ADDRESS, ethers.MaxUint256);
  await tx.wait();
  console.log(`[OnrampV2] Permit2 approved — txHash=${tx.hash}`);
}

async function depositViaRouter(
  chainId: number,
  externalToken: string,
  amount: bigint,
  stratoRecipient: string,
  targetStratoToken: string,
): Promise<string> {
  const signer = getSafeSigner(chainId);
  const routerAddress = getDepositRouterAddress();
  const stratoAddr = ethers.getAddress(`0x${stratoRecipient}`);
  const targetAddr = ethers.getAddress(`0x${targetStratoToken}`);
  const isNativeETH = externalToken === NATIVE_ETH;

  console.log(
    `[OnrampV2] Depositing via router — chainId=${chainId}, ` +
      `token=${isNativeETH ? "ETH (native)" : externalToken}, ` +
      `amount=${amount}, stratoRecipient=${stratoAddr}, targetStratoToken=${targetAddr}`
  );

  const router = new ethers.Contract(routerAddress, DEPOSIT_ROUTER_ABI, signer);
  let tx;

  if (isNativeETH) {
    tx = await router.depositETH(stratoAddr, targetAddr, { value: amount });
  } else {
    const tokenAddr = ethers.getAddress(externalToken);
    await ensurePermit2Allowance(signer, tokenAddr, amount);

    const nonce = BigInt(Date.now());
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await signPermit2(signer, chainId, tokenAddr, amount, routerAddress, nonce, deadline);

    tx = await router.deposit(tokenAddr, amount, stratoAddr, targetAddr, nonce, deadline, signature);
  }

  console.log(`[OnrampV2] Router deposit tx submitted — hash=${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`[OnrampV2] Router deposit confirmed — block=${receipt?.blockNumber}`);

  return tx.hash;
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

function toRawAmount(humanAmount: string, decimals: number): bigint {
  const [whole = "0", frac = ""] = humanAmount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac);
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

  const safeAddress = process.env.SAFE_ADDRESS;
  if (!safeAddress) throw new Error("SAFE_ADDRESS is not configured");

  const redirectUrl = process.env.MELD_REDIRECT_URL || "";
  const externalSessionId = `strato_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  console.log(`[OnrampV2] Creating session — user=${userStratoAddress}, provider=${serviceProvider}`);

  const { data } = await axios.post(
    `${MELD_API_URL}/crypto/session/widget`,
    {
      sessionData: {
        walletAddress: safeAddress,
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

  const padded = computed + "=".repeat((4 - (computed.length % 4)) % 4);
  return padded === signature || computed === signature;
}

// ————————————————————————————————————————————————————————————————
// Meld webhook handler
// ————————————————————————————————————————————————————————————————

const NATIVE_ETH = "0x0000000000000000000000000000000000000000";

// Token addresses on external chains — must match DepositRouter's tokenConfig
const EXTERNAL_TOKEN_BY_CHAIN: Record<number, Record<string, string>> = {
  1:        { eth: NATIVE_ETH, usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  11155111: { eth: NATIVE_ETH, usdc: "0x0c86A754A29714C4Fe9C6F1359fa7099eD174c0b" },
};

const EXTERNAL_DECIMALS: Record<string, number> = {
  eth: 18,
  usdc: 18, // Transak uses 18 decimals for USDC
};

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
    console.log(`[OnrampV2] Transaction data:`, tx);
    const cryptoDetails = tx.cryptoDetails;
    const rawCurrency: string = tx.destinationCurrencyCode;
    const amount: string = String(tx.destinationAmount);
    const txHash: string | undefined = cryptoDetails?.blockchainTransactionId;
    const chainIdStr: string | undefined = cryptoDetails?.chainId;

    if (!rawCurrency || !amount || !chainIdStr) {
      console.error(`[OnrampV2] Missing transaction details — currency=${rawCurrency}, amount=${amount}, chainId=${chainIdStr}`);
      return;
    }

    const currency = normalizeMeldCurrency(rawCurrency);
    const chainId = 11155111; // TODO: hardcoded to Sepolia for dev — Meld sandbox reports wrong chainId
    const externalToken = EXTERNAL_TOKEN_BY_CHAIN[chainId]?.[currency];
    const targetStratoToken = TARGET_STRATO_TOKEN[currency];
    const decimals = EXTERNAL_DECIMALS[currency];

    if (!externalToken || !targetStratoToken || decimals === undefined) {
      console.error(`[OnrampV2] Unsupported currency=${rawCurrency} or chainId=${chainId}`);
      return;
    }

    const rawAmount = toRawAmount(amount, decimals);

    try {
      const routerTxHash = await depositViaRouter(
        chainId,
        externalToken,
        rawAmount,
        userAddress,
        targetStratoToken,
      );
      console.log(`[OnrampV2] Deposit routed — routerTxHash=${routerTxHash}, bridge service will confirm`);
    } catch (err: any) {
      console.error(`[OnrampV2] depositViaRouter FAILED — ${err.message}`);
    }
  } else {
    console.log(`[OnrampV2] Transaction ${transactionId} → ${eventType} / ${status} (user=${userAddress})`);
  }
}

// ————————————————————————————————————————————————————————————————
// Meld API — User Transactions
// ————————————————————————————————————————————————————————————————

export interface OnrampTransaction {
  id: string;
  status: string;
  sourceAmount: number;
  sourceCurrencyCode: string;
  destinationAmount: number;
  destinationCurrencyCode: string;
  serviceProvider: string;
  createdAt: string;
  totalFee: number;
}

export async function getUserTransactions(
  userStratoAddress: string,
  params: { limit?: string; after?: string },
): Promise<{ data: OnrampTransaction[]; hasMore: boolean }> {
  if (!MELD_API_KEY) throw new Error("Meld onramp is not configured on this node");

  const { data } = await axios.get(`${MELD_API_URL}/payments/transactions`, {
    headers: meldHeaders(),
    params: {
      externalCustomerIds: userStratoAddress,
      limit: params.limit || "10",
      ...(params.after ? { after: params.after } : {}),
    },
  });

  const rawList = Array.isArray(data) ? data : (data?.transactions || data || []);

  const transactions: OnrampTransaction[] = rawList.map((tx: any) => ({
    id: tx.id,
    status: tx.status,
    sourceAmount: tx.sourceAmount,
    sourceCurrencyCode: tx.sourceCurrencyCode,
    destinationAmount: tx.destinationAmount,
    destinationCurrencyCode: tx.destinationCurrencyCode,
    serviceProvider: tx.serviceProvider,
    createdAt: tx.createdAt,
    totalFee: tx.cryptoDetails?.totalFee ?? 0,
  }));

  const requestedLimit = parseInt(params.limit || "10", 10);

  return {
    data: transactions,
    hasMore: transactions.length >= requestedLimit,
  };
}
