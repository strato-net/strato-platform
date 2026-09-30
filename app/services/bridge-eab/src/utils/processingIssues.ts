import { ProcessingContext, ProcessingIssue, ProcessingIssueCode, WithdrawalReleasePendingError } from "../types";

const messages: Record<ProcessingIssueCode, string> = {
  MINT_CAPACITY: "Mint allowance is insufficient; wait for refill or review the mint policy.",
  WITHDRAWAL_CAPACITY: "Withdrawal capacity is insufficient; wait for refill or pending reservations to clear.",
  FUNDING_REQUIRED: "The submitting account needs funding for transaction fees.",
  MANUAL_REVIEW: "Governance review is required; use the existing review queue.",
  POLICY_RESTRICTED: "The transfer is blocked by a route or token policy.",
  DEPENDENCY_UNAVAILABLE: "An RPC, verifier, or authentication dependency is unavailable.",
  CONFIRMATIONS_PENDING: "Waiting for external transaction confirmations.",
  INDEXING_PENDING: "Waiting for settlement attestations to be indexed.",
  PAUSED: "Bridge or route processing is paused.",
  CONFIGURATION: "Bridge configuration or authorization evidence needs operator investigation.",
  UNKNOWN: "An unexpected processing failure needs operator investigation.",
};

// Only these diagnostic fields may cross the verifier boundary or enter the journal.
const detailKeys = new Set(["token", "account", "required", "available", "limit", "capacity", "refillRate",
  "retryAfterSeconds", "observedConfirmations", "requiredConfirmations", "policyVersion", "policyDigest",
  "verifier", "stage", "feeAsset", "units", "observedAt", "transactionHash", "errorCode", "httpStatus", "operation"]);
const safeErrorReason = (value: string): string => {
  let reason = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (/password|secret|token|private.?key|api.?key|credential/i.test(name) && secret && secret.length >= 8) {
      reason = reason.split(secret).join("REDACTED");
    }
  }
  return reason.replace(/https?:\/\/[^\s"'<>]+/gi, "REDACTED_URL")
    .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi, "REDACTED_AUTH")
    .replace(/\b(?:authorization|password|secret|(?:access[_-]?|refresh[_-]?)?token|api[_-]?key|private[_-]?key|client[_-]?secret|cookie)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "REDACTED_CREDENTIAL")
    .replace(/\b(?:0x)?[a-fA-F0-9]{64,}\b/g, "REDACTED_HEX")
    // Ethers and HTTP errors can append serialized requests or response bodies.
    .split(/[\r\n({\[]|\b(?:request|response|payload|headers|config)\s*[:=]/i, 1)[0]
    .replace(/[^\x20-\x7E]/g, " ").trim().slice(0, 240);
};
export const safeIssueDetails = (value: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object") return result;
  for (const [key, v] of Object.entries(value)) {
    if (key === "reason" && typeof v === "string") {
      const reason = safeErrorReason(v);
      if (reason) result.reason = reason;
    }
    if (detailKeys.has(key) && typeof v === "string" && /^[a-zA-Z0-9_.: -]{1,160}$/.test(v)) result[key] = v;
  }
  return result;
};

export const processingIssue = (code: ProcessingIssueCode, details: Record<string, string> = {}): ProcessingIssue => ({
  code, message: messages[code], retryable: ["MINT_CAPACITY", "WITHDRAWAL_CAPACITY", "FUNDING_REQUIRED",
    "DEPENDENCY_UNAVAILABLE", "CONFIRMATIONS_PENDING", "INDEXING_PENDING", "PAUSED"].includes(code), details: safeIssueDetails(details),
});

export const classifyProcessingError = (error: any, depth = 0): ProcessingIssue[] => {
  if (depth > 8) return [processingIssue("UNKNOWN")];
  if (Array.isArray(error?.issues) && error.issues.length) {
    return error.issues.slice(0, 32).map((issue: any) => processingIssue(
      Object.prototype.hasOwnProperty.call(messages, issue?.code) ? issue.code : "UNKNOWN", issue?.details));
  }
  const body = error?.response?.data;
  if (body && body.code !== "UNKNOWN" && Object.prototype.hasOwnProperty.call(messages, body.code)) {
    return [processingIssue(body.code, { ...safeIssueDetails(body.details),
      ...safeIssueDetails({ policyVersion: body.policyVersion, policyDigest: body.policyDigest }) })];
  }
  if (error?.cause && error.cause !== error) return classifyProcessingError(error.cause, depth + 1);
  const message = [body?.error?.message, body?.error, body?.message, error?.message, error?.shortMessage, error]
    .find(value => typeof value === "string" && value.length) || "";
  let code: ProcessingIssueCode = "UNKNOWN";
  if (body?.code === "UNKNOWN") code = "UNKNOWN";
  else if (body?.decision === "pending_confirmations" || error instanceof WithdrawalReleasePendingError || /insufficient confirmations|awaiting.*confirmations/i.test(message)) code = "CONFIRMATIONS_PENDING";
  else if (/mint limit exceeded/i.test(message)) code = "MINT_CAPACITY";
  else if (/withdrawal capacity|bucket.*(?:exhaust|capacity)|insufficient.*liquidity/i.test(message)) code = "WITHDRAWAL_CAPACITY";
  else if (/low account balance|insufficient funds.*(?:gas|transaction)|insufficient.*(?:voucher|fee balance)/i.test(message)) code = "FUNDING_REQUIRED";
  else if (body?.decision === "manual_review" || /manual review|automatic approval limit/i.test(message)) code = "MANUAL_REVIEW";
  else if (/paused/i.test(message)) code = "PAUSED";
  else if (/policy rejects|token is disabled|route.*disabled|exceeds destination vault maximum/i.test(message)) code = "POLICY_RESTRICTED";
  else if (/mismatched reservation|not configured|signer.*(?:mismatch|version)|configuration/i.test(message)) code = "CONFIGURATION";
  else if (/ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout|network|socket|Cloudflare|rate limit|verifier unavailable|RPC unavailable/i.test(`${error?.code} ${message}`) ||
      [401, 403, 429].includes(error?.response?.status) || error?.response?.status >= 500) code = "DEPENDENCY_UNAVAILABLE";
  const details: Record<string, string> = {};
  if (code === "UNKNOWN") {
    Object.assign(details, safeIssueDetails(body?.details), safeIssueDetails({ policyVersion: body?.policyVersion, policyDigest: body?.policyDigest }));
    if (message) details.reason = message;
    if (typeof error?.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(error.code)) details.errorCode = error.code;
    if (Number.isInteger(error?.response?.status)) details.httpStatus = String(error.response.status);
    if (typeof error?.action === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(error.action)) details.operation = error.action;
    const hash = error?.transactionHash || error?.receipt?.hash || error?.transaction?.hash;
    if (typeof hash === "string" && /^(0x)?[a-fA-F0-9]{64}$/.test(hash)) details.transactionHash = hash;
  }
  return [processingIssue(code, details)];
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

export const processingProgress = (issues: ProcessingIssue[], previous: Record<string, string> = {}): Record<string, string> => {
  const progress = { ...previous };
  for (const issue of issues) {
    const observed = issue.code === "CONFIRMATIONS_PENDING" ? issue.details.observedConfirmations
      : issue.code === "INDEXING_PENDING" ? issue.details.available : undefined;
    if (!observed || !/^\d+$/.test(observed)) continue;
    const key = JSON.stringify([issue.code, issue.details.verifier || "", issue.details.transactionHash || ""]);
    if (BigInt(observed) > BigInt(progress[key] || "0")) progress[key] = observed;
  }
  return progress;
};
