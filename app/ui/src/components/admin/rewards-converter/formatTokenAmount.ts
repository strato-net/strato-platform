import type { RewardsConverterToken } from "@strato/shared-types";
import { formatBalance } from "@/utils/numberUtils";

/** A raw amount of one of the converter's tokens, to 2–4 decimals with its symbol. */
export const formatTokenAmount = (raw: string, { symbol, decimals }: RewardsConverterToken): string =>
  formatBalance(raw, symbol, decimals, 2, 4);
