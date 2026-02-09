import type { CreditCardConfig } from "@mercata/shared-types";

const requiredStrings = (obj: Record<string, any>, keys: string[]) => {
  for (const k of keys) {
    if (typeof obj[k] !== "string" || !(obj[k] as string).trim()) {
      throw new Error(`Missing or invalid: ${k}`);
    }
  }
};

export function validateUpsertConfig(body: unknown): asserts body is Omit<CreditCardConfig, "userAddress"> {
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
}
