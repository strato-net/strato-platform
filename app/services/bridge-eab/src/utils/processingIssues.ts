import { ProcessingContext, ProcessingIssue, ProcessingIssueCode, WithdrawalReleasePendingError } from "../types";

const messages: Record<ProcessingIssueCode, string> = {
  MINT_CAPACITY: "Mint allowance is insufficient; wait for refill or review the mint policy.",
  WITHDRAWAL_CAPACITY: "Withdrawal capacity is insufficient; wait for refill or pending reservations to clear.",
  FUNDING_REQUIRED: "The submitting account needs funding for transaction fees.",
  MANUAL_REVIEW: "Governance review is required; use the existing review queue.",
  POLICY_RESTRICTED: "The transfer is blocked by a route or token policy.",
  DEPENDENCY_UNAVAILABLE: "An RPC, verifier, or authentication dependency is unavailable.",
  CONFIRMATIONS_PENDING: "Waiting for external transaction confirmations.",
  PAUSED: "Bridge or route processing is paused.",
  CONFIGURATION: "Bridge configuration or authorization evidence needs operator investigation.",
  UNKNOWN: "An unexpected processing failure needs operator investigation.",
};

// Only these diagnostic fields may cross the verifier boundary or enter the journal.
const detailKeys = new Set(["token", "account", "required", "available", "limit", "capacity", "refillRate",
  "retryAfterSeconds", "observedConfirmations", "requiredConfirmations", "policyVersion", "policyDigest",
  "verifier", "stage", "feeAsset", "units", "observedAt", "transactionHash"]);
export const safeIssueDetails = (value: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object") return result;
  for (const [key, v] of Object.entries(value)) {
    if (detailKeys.has(key) && typeof v === "string" && /^[a-zA-Z0-9_.: -]{1,160}$/.test(v)) result[key] = v;
  }
  return result;
};

export const processingIssue = (code: ProcessingIssueCode, details: Record<string, string> = {}): ProcessingIssue => ({
  code, message: messages[code], retryable: ["MINT_CAPACITY", "WITHDRAWAL_CAPACITY", "FUNDING_REQUIRED",
    "DEPENDENCY_UNAVAILABLE", "CONFIRMATIONS_PENDING", "PAUSED"].includes(code), details: safeIssueDetails(details),
});

export const classifyProcessingError = (error: any, depth = 0): ProcessingIssue[] => {
  if (depth > 8) return [processingIssue("UNKNOWN")];
  if (Array.isArray(error?.issues) && error.issues.length) {
    return error.issues.slice(0, 32).map((issue: any) => processingIssue(
      Object.prototype.hasOwnProperty.call(messages, issue?.code) ? issue.code : "UNKNOWN", issue?.details));
  }
  const body = error?.response?.data;
  if (body && Object.prototype.hasOwnProperty.call(messages, body.code)) {
    return [processingIssue(body.code, { ...safeIssueDetails(body.details),
      ...safeIssueDetails({ policyVersion: body.policyVersion, policyDigest: body.policyDigest }) })];
  }
  if (error?.cause && error.cause !== error) return classifyProcessingError(error.cause, depth + 1);
  const message = String(body?.error || error?.message || "");
  let code: ProcessingIssueCode = "UNKNOWN";
  if (body?.decision === "pending_confirmations" || error instanceof WithdrawalReleasePendingError || /insufficient confirmations|awaiting.*confirmations/i.test(message)) code = "CONFIRMATIONS_PENDING";
  else if (/mint limit exceeded/i.test(message)) code = "MINT_CAPACITY";
  else if (/withdrawal capacity|bucket.*(?:exhaust|capacity)|insufficient.*liquidity/i.test(message)) code = "WITHDRAWAL_CAPACITY";
  else if (/low account balance|insufficient funds.*(?:gas|transaction)|insufficient.*(?:voucher|fee balance)/i.test(message)) code = "FUNDING_REQUIRED";
  else if (body?.decision === "manual_review" || /manual review|automatic approval limit/i.test(message)) code = "MANUAL_REVIEW";
  else if (/paused/i.test(message)) code = "PAUSED";
  else if (/policy rejects|token is disabled|route.*disabled|exceeds destination vault maximum/i.test(message)) code = "POLICY_RESTRICTED";
  else if (/mismatched reservation|not configured|signer.*(?:mismatch|version)|configuration/i.test(message)) code = "CONFIGURATION";
  else if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|network|socket|Cloudflare|rate limit|verifier unavailable|RPC unavailable/i.test(`${error?.code} ${message}`) ||
      [401, 403, 429].includes(error?.response?.status) || error?.response?.status >= 500) code = "DEPENDENCY_UNAVAILABLE";
  return [processingIssue(code)];
};

export const verifierIssues = (error: unknown, index: number): ProcessingIssue[] =>
  classifyProcessingError(error).map(issue => ({ ...issue, details: { ...issue.details, verifier: String(index + 1) } }));

export const verifierFailureDetails = (error: unknown, policyVersion: string, policyDigest: string, attestor?: string) => {
  const issue = classifyProcessingError(error)[0];
  return { code: issue.code, retryable: issue.retryable, details: { ...issue.details,
    ...(issue.code === "FUNDING_REQUIRED" && attestor ? safeIssueDetails({ account: attestor, feeAsset: "USDST-or-vouchers" }) : {}),
  }, policyVersion, policyDigest };
};

export const processingKey = (context: ProcessingContext): string => JSON.stringify([
  context.source, context.chainId, context.bridge.toLowerCase().replace(/^0x/, ""), context.reference, context.stage,
]);
