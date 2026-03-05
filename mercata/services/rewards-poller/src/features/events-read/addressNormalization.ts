import { BonusTokenConfig } from "../../shared/types";
import { normalizeAddressNoPrefix } from "../../shared/core/address";

export interface BonusTokenRule {
  sourceContract: string;
  bonusBps: number;
  minBalance: bigint;
}

export const buildBonusRuleByToken = (
  tokenConfigs: BonusTokenConfig[]
): Map<string, BonusTokenRule> =>
  new Map(
    tokenConfigs.map((config) => [
      normalizeAddressNoPrefix(config.address),
      {
        sourceContract: config.address,
        bonusBps: config.bonusBps,
        minBalance: BigInt(config.minBalance),
      },
    ])
  );

export const normalizeAddressSet = (addresses: string[]): Set<string> =>
  new Set(addresses.map((address) => normalizeAddressNoPrefix(address)));

export const normalizeAddressValue = (address: unknown): string =>
  normalizeAddressNoPrefix(String(address ?? ""));

export const normalizeTrimmedAddressValue = (address: unknown): string =>
  normalizeAddressNoPrefix(String(address ?? "").trim());
