import { id } from "ethers";
import type { ProcessingIssueCode } from "@strato/shared-types";

// Constants
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const STRATO_DECIMALS = 18;
export const WAD = 10n ** 18n;
export const VERIFIER_REQUEST_TIMEOUT_MS = 60_000;
export const NATIVE_VERIFIER_REQUEST_TIMEOUT_MS = Number(
  process.env.NATIVE_VERIFIER_REQUEST_TIMEOUT_MS || VERIFIER_REQUEST_TIMEOUT_MS,
);
export const EXTERNAL_BRIDGE_LOG_BLOCK_RANGE = 1_000;
// HyperEVM caps JSON-RPC batches at 20 calls per HTTP request
export const RPC_BATCH_LIMIT = 20;
export const TRACE_RPC_PROBE_BLOCKS = 20;
export const CIRRUS_PAGE_SIZE = 200;
export const CIRRUS_FILTER_BATCH_SIZE = 20;

export const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
];

export const STANDARD_DEPOSIT_EVENT_SIGNATURE = id(
  "DepositRouted(address,uint256,address,address,address,uint96)",
);
export const ACTION_DEPOSIT_EVENT_SIGNATURE = id(
  "DepositRoutedWithAction(address,uint256,address,address,address,uint96,uint8,address,uint256)",
);
export const DEPOSIT_EVENT_SIGNATURES = [
  STANDARD_DEPOSIT_EVENT_SIGNATURE,
  ACTION_DEPOSIT_EVENT_SIGNATURE,
];

// RedemptionRequested(address indexed representationToken, uint256 amount, address indexed sender, address indexed stratoRecipient, uint96 redemptionId)
export const NATIVE_REDEMPTION_EVENT_SIGNATURE =
  "0x8c3e37d44910f9975cca29b1cbb70b943d7107cf2091576b3291d4316c74129a";

export const NATIVE_ROUTED_REDEMPTION_EVENT_SIGNATURE = id(
  "RedemptionRequestedWithRoute(address,uint256,address,address,uint96,address,uint256)",
);

// Transfer(address,address,uint256)
export const TRANSFER_EVENT_SIGNATURE =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Error file configuration
export const ERROR_FILE_NAME = "bridge-error.flag";
export const HEALTH_POLL_TIMEOUT_MS = 15 * 60_000;

export const PROCESSING_RETRY_BASE_MS = 30_000;
export const PROCESSING_RETRY_MAX_MS = 5 * 60_000;
export const PROCESSING_ALERT_GRACE_MS = 5 * 60_000;
export const PROCESSING_DEFERRED_ALERT_CODES: readonly string[] = ["DEPENDENCY_UNAVAILABLE", "CONFIRMATIONS_PENDING", "INDEXING_PENDING", "UNKNOWN"];
export const PROCESSING_REMINDER_MS = 60 * 60_000;
export const PROCESSING_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const EMAIL_METADATA_TIMEOUT_MS = 5_000;

export const PROCESSING_EMAIL_CONTENT: Record<ProcessingIssueCode, { title: string; action: string; observation?: string }> = {
  MINT_CAPACITY: { title: "Mint allowance is insufficient", action: "Compare the transfer amount with the token's available mint allowance and refill rate. If it cannot fit within the configured limit, ask STRATO admins to review the mint policy." },
  WITHDRAWAL_CAPACITY: { title: "Withdrawal capacity or liquidity is insufficient", action: "Check available withdrawal capacity, external liquidity, and pending reservations. If capacity cannot recover through refill or completed withdrawals, escalate to the bridge policy owner." },
  FUNDING_REQUIRED: { title: "Transaction fee funding needed", action: "Fund the submitting account shown in the details with the required fee asset. If the account is absent, identify the failed transaction sender before funding." },
  MANUAL_REVIEW: { title: "Governance review required", action: "Follow the separate review notification, which identifies whether STRATO admins or Safe signers must act. This processing alert does not authorize a transfer or refund." },
  POLICY_RESTRICTED: { title: "Transfer blocked by policy", action: "Identify the blocking route, token, or verifier policy in the diagnostics. Ask its policy owner to review the restriction before changing it." },
  DEPENDENCY_UNAVAILABLE: { title: "A required service is unavailable", action: "Check the failed RPC, verifier, or authentication request in the diagnostics and restore access to that dependency." },
  CONFIRMATIONS_PENDING: { title: "External confirmations still pending", observation: "The observed external confirmation count remains below the required count. This does not by itself establish that the external network has stalled.", action: "Check the external transaction receipt and current block height, then compare the verifier RPC responses. Investigate any disagreement or lack of chain progress." },
  INDEXING_PENDING: { title: "Verifier confirmations still pending", observation: "The verifier confirmation count visible in Cirrus remains below the required count. This does not establish whether STRATO transaction processing or Cirrus indexing is delayed.", action: "Check whether the verifiers' attestation transactions succeeded on STRATO. Then compare the on-chain confirmations with Cirrus. Refund voting must wait until the required confirmations are visible; do not bypass that check." },
  PAUSED: { title: "Bridge processing is paused", action: "Confirm with the bridge policy owner whether the pause is intentional. If it should be lifted, use the authorized governance controls." },
  CONFIGURATION: { title: "Bridge configuration needs review", action: "Compare the referenced transfer's authorization and reservation with the configured bridge, vault, and signer set. Correct the identified configuration issue through its authorized owner." },
  UNKNOWN: { title: "Processing needs investigation", action: "Inspect the bridge service and verifier logs for the reference and stage below. The cause has not yet been identified; determine it before taking a recovery action." },
};

const config = {
  auth: {
    baUsername: process.env.BA_USERNAME,
    baPassword: process.env.BA_PASSWORD,
    clientSecret: process.env.CLIENT_SECRET,
    clientId: process.env.CLIENT_ID,
    openIdDiscoveryUrl: process.env.OPENID_DISCOVERY_URL,
  },
  relayerAuth: {
    baUsername: process.env.RELAYER_BA_USERNAME,
    baPassword: process.env.RELAYER_BA_PASSWORD,
    clientSecret: process.env.RELAYER_CLIENT_SECRET,
    clientId: process.env.RELAYER_CLIENT_ID,
    openIdDiscoveryUrl: process.env.RELAYER_OPENID_DISCOVERY_URL,
  },
  externalAssetBridge: {
    address: process.env.EXTERNAL_ASSET_BRIDGE_ADDRESS,
    manualReviewValiditySeconds: Number(
      process.env.EXTERNAL_BRIDGE_MANUAL_REVIEW_VALIDITY_SECONDS ||
        7 * 24 * 60 * 60,
    ),
  },
  tokenRouter: {
    address: process.env.TOKEN_ROUTER,
  },
  nativeBridge: {
    address: process.env.STRATO_NATIVE_BRIDGE_ADDRESS,
  },
  oracle: {
    address: process.env.PRICE_ORACLE_ADDRESS,
  },
  usdst: {
    address: process.env.USDST_ADDRESS || '937efa7e3a77e20bbdbd7c0d32b6514f368c1010',
  },
  safe: {
    address: process.env.SAFE_ADDRESS,
    safeProposerAddress: process.env.SAFE_PROPOSER_ADDRESS,
    safeProposerKmsKeyId: process.env.SAFE_PROPOSER_KMS_KEY_ID,
    safeProposerKmsRegion: process.env.SAFE_PROPOSER_KMS_REGION,
    apiKey: process.env.SAFE_API_KEY,
  },
  voucher: {
    contractAddress:
      process.env.VOUCHER_CONTRACT_ADDRESS ||
      "000000000000000000000000000000000000100e",
    mintCount: 25,
  },
  polling: {
    bridgeInInterval: 1 * 60 * 1000, // 1 minute
    bridgeOutInterval: 1 * 60 * 1000, // 1 minute (was 3 minutes)
    withdrawalInterval: 1 * 60 * 1000, // 1 minute (was 10 seconds)
    ethereumDepositInterval: 1 * 60 * 1000, // 1 minute (was 2 minutes)
  },
  balance: {
    gasFeeUSDST: BigInt(process.env.GAS_FEE_USDST || '1') * BigInt(1e16),
    gasFeeVoucher: BigInt(process.env.GAS_FEE_VOUCHER || '100') * BigInt(1e16),
    minTransactionsThreshold: BigInt(process.env.MIN_TRANSACTIONS_THRESHOLD || '200'),
  },
  strato: {
    gas: {
      limit: 32_100_000_000,
      price: 1,
    },
    polling: {
      defaultTimeout: 60_000,
      defaultInterval: 5_000,
    },
    tx: {
      type: "FUNCTION" as const,
    },
  },
  email: {
    approverEmails: process.env.TRANSACTION_APPROVER_EMAILS?.split(",").map(value => value.trim()).filter(Boolean) || [],
  },
  api: {
    nodeUrl: process.env.NODE_URL,
    appUrl: process.env.STRATO_APP_API_URL,
    errorCodes: {
      ECONNREFUSED: "Connection refused",
      ENOTFOUND: "DNS lookup failed",
      ETIMEDOUT: "Request timeout",
    },
    defaults: {
      timeout: 60_000,
      maxAttempts: 2,
    },
  },
};

export { config };

export const getChainRpcUrl = (chainId: number | bigint): string => {
  const chainIdStr = chainId.toString();
  const rpcUrl = process.env[`CHAIN_${chainIdStr}_RPC_URL`];

  if (!rpcUrl) {
    throw new Error(
      `CHAIN_${chainIdStr}_RPC_URL environment variable is not configured`,
    );
  }

  return rpcUrl;
};

export const getChainRpcUrls = (chainId: number | bigint): string[] => [
  getChainRpcUrl(chainId),
  ...(process.env[`CHAIN_${chainId}_VERIFICATION_RPC_URLS`] || "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
];

export const getDepositConfirmationPolicy = (
  chainId: number | bigint,
): number => {
  const value =
    process.env[`CHAIN_${chainId}_DEPOSIT_CONFIRMATIONS`] ||
    process.env.DEPOSIT_CONFIRMATIONS;
  const confirmations = Number(value);
  if (!Number.isSafeInteger(confirmations) || confirmations <= 0) {
    throw new Error(`Invalid deposit confirmation policy for chain ${chainId}`);
  }
  return confirmations;
};

export const DEPOSIT_WS_RECONNECT_BASE_MS = 1_000;
export const DEPOSIT_WS_RECONNECT_MAX_MS = 60_000;

export const getDepositReconciliationDepth = (): number =>
  Number(process.env.DEPOSIT_RECONCILIATION_BLOCKS || 64);

export const getMissingReceiptGraceMs = (): number =>
  Number(process.env.DEPOSIT_MISSING_RECEIPT_GRACE_MS || 5 * 60 * 1000);

export const getSettlementRetryGraceMs = (): number =>
  Number(process.env.DEPOSIT_SETTLEMENT_RETRY_GRACE_MS || 15 * 60 * 1000);

export const getReviewRecordRetryMs = (): number =>
  Number(process.env.DEPOSIT_REVIEW_RECORD_RETRY_MS || 60 * 1000);

export const getChainWsRpcUrl = (
  chainId: number | bigint,
): string | undefined =>
  process.env[`CHAIN_${chainId}_WS_RPC_URL`];

export const getNativeRepresentationBridgeAddress = (
  chainId: number | bigint,
): string | undefined => {
  const chainIdStr = chainId.toString();
  return process.env[`CHAIN_${chainIdStr}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`];
};

export const getExternalBridgeVerifierUrls = (
  chainId: number | bigint,
): string[] =>
  (process.env[`CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_URLS`] || "")
    .split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);

export const getExternalBridgeVerifierApiTokens = (
  chainId: number | bigint,
): string[] =>
  (process.env[`CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS`] || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

export const getNativeVerifierUrls = (
  chainId: number | bigint,
): string[] =>
  (process.env[`CHAIN_${chainId}_NATIVE_VERIFIER_URLS`] || "")
    .split(",")
    .map((url) => url.trim().replace(/\/$/, ""))
    .filter(Boolean);

export const getNativeVerifierApiTokens = (
  chainId: number | bigint,
): string[] =>
  (process.env[`CHAIN_${chainId}_NATIVE_VERIFIER_API_TOKENS`] || "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

export const getNativeMintExecutorPrivateKey = (
  chainId: number | bigint,
): string | undefined =>
  process.env[`CHAIN_${chainId}_NATIVE_MINT_EXECUTOR_PRIVATE_KEY`]?.trim();

export const getExternalBridgeExecutorPrivateKey = (
  chainId: number | bigint,
): string | undefined =>
  process.env[`CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY`]?.trim();

export interface ExternalBridgeExecutorKmsConfig {
  address: string;
  keyId: string;
  region: string;
}

export const getExternalBridgeExecutorKmsConfig = (
  chainId: number | bigint,
): ExternalBridgeExecutorKmsConfig | undefined => {
  const prefix = `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR`;
  const address = process.env[`${prefix}_ADDRESS`]?.trim();
  const keyId = process.env[`${prefix}_KMS_KEY_ID`]?.trim();
  const region = process.env[`${prefix}_KMS_REGION`]?.trim();

  if (!address && !keyId && !region) return undefined;
  return { address: address || "", keyId: keyId || "", region: region || "" };
};

// Validate required environment variables
const requiredEnvVars = [
  "BA_USERNAME",
  "BA_PASSWORD",
  "CLIENT_SECRET",
  "CLIENT_ID",
  "OPENID_DISCOVERY_URL",
  "RELAYER_BA_USERNAME",
  "RELAYER_BA_PASSWORD",
  "RELAYER_CLIENT_SECRET",
  "RELAYER_CLIENT_ID",
  "RELAYER_OPENID_DISCOVERY_URL",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS",
  "SAFE_ADDRESS",
  "SAFE_PROPOSER_ADDRESS",
  "SAFE_PROPOSER_KMS_KEY_ID",
  "SAFE_PROPOSER_KMS_REGION",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  const error = `Missing required environment variables when initializing the config: ${missingEnvVars.join(", ")}`;
  console.error(error);
  process.exit(2);
}

export const NATIVE_SCAN_WINDOW_BLOCKS = 2_000;
