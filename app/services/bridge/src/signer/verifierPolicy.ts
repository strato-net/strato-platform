import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAddress } from "ethers";
import { DepositSettlementAttestation } from "./settlementValidation";

export interface VerifierRoutePolicy {
  externalToken: string;
  stratoToken: string;
  depositsEnabled: boolean;
  autoRouteEnabled: boolean;
  maxAutoDepositAmount: string;
}

export interface VerifierTokenPolicy {
  token: string;
  withdrawalsEnabled: boolean;
  maxAutoWithdrawalAmount: string;
}

export interface VerifierPolicy {
  version: string;
  baselinePolicyHash: string;
  verifierIndex: number;
  settlementAttestor: string;
  sourceChainId: string;
  sourceBridge: string;
  destinationChainId: string;
  destinationVault: string;
  routes: VerifierRoutePolicy[];
  tokens: VerifierTokenPolicy[];
}

export interface WithdrawalPolicyInput {
  token: string;
  amount: string;
}

export interface PolicyDecision {
  decision: "approve" | "manual_review";
  reason: string;
}

const uint = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be an unsigned integer string`);
  }
  return BigInt(value).toString();
};

const stratoAddress = (value: unknown, label: string): string => {
  const normalized = String(value || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a STRATO address`);
  }
  return normalized;
};

const ethereumAddress = (value: unknown, label: string): string => {
  try {
    return getAddress(String(value));
  } catch {
    throw new Error(`${label} must be an Ethereum address`);
  }
};

export const loadVerifierPolicy = (
  filePath: string,
): { policy: VerifierPolicy; digest: string } => {
  const source = readFileSync(filePath);
  const input = JSON.parse(source.toString()) as Partial<VerifierPolicy>;
  if (!input.version?.trim()) throw new Error("Verifier policy version is required");
  if (
    !/^sha256:[0-9a-f]{64}$/.test(String(input.baselinePolicyHash || ""))
  ) {
    throw new Error("Verifier policy baselinePolicyHash is invalid");
  }
  if (
    !Number.isSafeInteger(input.verifierIndex) ||
    Number(input.verifierIndex) <= 0
  ) {
    throw new Error("Verifier policy verifierIndex must be positive");
  }
  const routes = (input.routes || []).map((route, index) => ({
    externalToken: ethereumAddress(
      route.externalToken,
      `routes[${index}].externalToken`,
    ),
    stratoToken: stratoAddress(
      route.stratoToken,
      `routes[${index}].stratoToken`,
    ),
    depositsEnabled: route.depositsEnabled === true,
    autoRouteEnabled: route.autoRouteEnabled === true,
    maxAutoDepositAmount: uint(
      route.maxAutoDepositAmount,
      `routes[${index}].maxAutoDepositAmount`,
    ),
  }));
  const tokens = (input.tokens || []).map((token, index) => ({
    token: ethereumAddress(token.token, `tokens[${index}].token`),
    withdrawalsEnabled: token.withdrawalsEnabled === true,
    maxAutoWithdrawalAmount: uint(
      token.maxAutoWithdrawalAmount,
      `tokens[${index}].maxAutoWithdrawalAmount`,
    ),
  }));
  const routeKeys = routes.map(
    ({ externalToken, stratoToken }) =>
      `${externalToken.toLowerCase()}:${stratoToken}`,
  );
  const tokenKeys = tokens.map(({ token }) => token.toLowerCase());
  if (new Set(routeKeys).size !== routeKeys.length) {
    throw new Error("Verifier policy contains duplicate routes");
  }
  if (new Set(tokenKeys).size !== tokenKeys.length) {
    throw new Error("Verifier policy contains duplicate tokens");
  }
  const baseline = {
    version: input.version, sourceChainId: input.sourceChainId, sourceBridge: input.sourceBridge,
    destinationChainId: input.destinationChainId, destinationVault: input.destinationVault,
    routes: input.routes, tokens: input.tokens,
  };
  const baselineHash = `sha256:${createHash("sha256").update(JSON.stringify(baseline)).digest("hex")}`;
  if (input.baselinePolicyHash !== baselineHash) throw new Error("Verifier baseline policy hash does not match policy limits");
  return {
    policy: {
      version: input.version.trim(),
      baselinePolicyHash: input.baselinePolicyHash!,
      verifierIndex: Number(input.verifierIndex),
      settlementAttestor: stratoAddress(
        input.settlementAttestor,
        "settlementAttestor",
      ),
      sourceChainId: uint(input.sourceChainId, "sourceChainId"),
      sourceBridge: stratoAddress(input.sourceBridge, "sourceBridge"),
      destinationChainId: uint(
        input.destinationChainId,
        "destinationChainId",
      ),
      destinationVault: ethereumAddress(
        input.destinationVault,
        "destinationVault",
      ),
      routes,
      tokens,
    },
    digest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
  };
};

export const evaluateDepositPolicy = (
  policy: VerifierPolicy,
  deposit: DepositSettlementAttestation,
): PolicyDecision => {
  const route = policy.routes.find(
    (candidate) =>
      candidate.externalToken.toLowerCase() ===
        getAddress(deposit.externalToken).toLowerCase() &&
      candidate.stratoToken ===
        stratoAddress(deposit.stratoToken, "deposit.stratoToken"),
  );
  if (!route || !route.depositsEnabled) {
    throw new Error("Local verifier policy rejects the deposit route");
  }
  const action = Number(deposit.action);
  if (action !== 0 && !(action === 4 && route.autoRouteEnabled)) {
    throw new Error("Local verifier policy rejects the deposit action");
  }
  if (action === 4 && (BigInt(uint(deposit.minFinalOut, "deposit.minFinalOut")) === 0n ||
      /^0+$/.test(stratoAddress(deposit.actionToken, "deposit.actionToken")))) {
    throw new Error("AUTO_ROUTE requires a destination token and positive minFinalOut");
  }
  if (BigInt(deposit.externalTokenAmount) > BigInt(route.maxAutoDepositAmount)) {
    return {
      decision: "manual_review",
      reason: "deposit exceeds local automatic approval limit",
    };
  }
  return { decision: "approve", reason: "local deposit policy satisfied" };
};

export const evaluateWithdrawalPolicy = (
  policy: VerifierPolicy,
  withdrawal: WithdrawalPolicyInput,
): PolicyDecision => {
  const token = policy.tokens.find(
    (candidate) =>
      candidate.token.toLowerCase() === getAddress(withdrawal.token).toLowerCase(),
  );
  if (!token || !token.withdrawalsEnabled) {
    throw new Error("Local verifier policy rejects withdrawals for this token");
  }
  if (BigInt(withdrawal.amount) > BigInt(token.maxAutoWithdrawalAmount)) {
    return {
      decision: "manual_review",
      reason: "withdrawal exceeds local automatic approval limit",
    };
  }
  return { decision: "approve", reason: "local withdrawal policy satisfied" };
};
