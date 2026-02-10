import type { CreditCardConfig } from "@mercata/shared-types";

const requiredStrings = (obj: Record<string, any>, keys: string[]) => {
  for (const k of keys) {
    if (typeof obj[k] !== "string" || !(obj[k] as string).trim()) {
      throw new Error(`Missing or invalid: ${k}`);
    }
  }
};

export function validateUpsertConfig(
  body: unknown
): asserts body is Omit<CreditCardConfig, "userAddress"> & { id?: string } {
  if (!body || typeof body !== "object") throw new Error("Body must be an object");
  const b = body as Record<string, any>;
  requiredStrings(b, ["destinationChainId", "cardWalletAddress", "externalToken", "thresholdAmount", "topUpAmount"]);
  if (typeof b.useBorrow !== "boolean") throw new Error("useBorrow must be a boolean");
  if (typeof b.checkFrequencyMinutes !== "number" || b.checkFrequencyMinutes < 1) {
    throw new Error("checkFrequencyMinutes must be a positive number");
  }
  if (typeof b.cooldownMinutes !== "number" || b.cooldownMinutes < 0) {
    throw new Error("cooldownMinutes must be a non-negative number");
  }
  if (typeof b.enabled !== "boolean") throw new Error("enabled must be a boolean");
  if (b.nickname !== undefined && b.nickname !== null && typeof b.nickname !== "string") {
    throw new Error("nickname must be a string");
  }
  if (b.providerId !== undefined && b.providerId !== null && typeof b.providerId !== "string") {
    throw new Error("providerId must be a string");
  }
}

export type AddCardBody = {
  nickname: string;
  providerId: string;
  destinationChainId: string;
  externalToken: string;
  cardWalletAddress: string;
  thresholdAmount: string;
  cooldownMinutes: number;
  topUpAmount: string;
};

export function validateAddCardBody(body: unknown): asserts body is AddCardBody {
  if (!body || typeof body !== "object") throw new Error("Body must be an object");
  const b = body as Record<string, any>;
  requiredStrings(b, ["destinationChainId", "externalToken", "cardWalletAddress"]);
  if (typeof b.thresholdAmount !== "string") throw new Error("thresholdAmount must be a string (wei)");
  if (typeof b.cooldownMinutes !== "number" || b.cooldownMinutes < 0 || !Number.isInteger(b.cooldownMinutes)) {
    throw new Error("cooldownMinutes must be a non-negative integer");
  }
  if (typeof b.topUpAmount !== "string") throw new Error("topUpAmount must be a string (wei)");
  if (b.nickname !== undefined && b.nickname !== null && typeof b.nickname !== "string") {
    throw new Error("nickname must be a string");
  }
  if (b.providerId !== undefined && b.providerId !== null && typeof b.providerId !== "string") {
    throw new Error("providerId must be a string");
  }
}

export type UpdateCardBody = AddCardBody & { index: number };

export function validateUpdateCardBody(body: unknown): asserts body is UpdateCardBody {
  validateAddCardBody(body);
  const b = body as Record<string, any>;
  if (typeof b.index !== "number" || b.index < 0 || !Number.isInteger(b.index)) {
    throw new Error("index must be a non-negative integer");
  }
}
