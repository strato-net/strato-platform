import type { RewardsConverterToken } from "@strato/shared-types";
import { formatAmount } from "@/utils/rewardsConverterMath";

/** A raw amount of one of the converter's tokens, to 2–4 decimals with its symbol, or to one for a whole number. */
export const formatTokenAmount = (raw: string, token: RewardsConverterToken): string =>
  formatAmount(raw, token, 4);
