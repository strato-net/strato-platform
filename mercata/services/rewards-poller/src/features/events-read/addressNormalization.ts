import { BonusTokenConfig } from "../../shared/types";
import { normalizeAddressNoPrefix } from "../../shared/core/address";

export interface BonusTokenRule {
  sourceContract: string;
  maxBonusBps: number;
  balanceForMaxBoost: bigint;
}

export const buildBonusRuleByToken = (
  tokenConfigs: BonusTokenConfig[]
): Map<string, BonusTokenRule> =>
  new Map(
    tokenConfigs.map((config) => [
      normalizeAddressNoPrefix(config.address),
      {
        sourceContract: config.address,
        maxBonusBps: config.maxBonusBps,
        balanceForMaxBoost: BigInt(config.balanceForMaxBoost),
      },
    ])
  );

export const normalizeAddressSet = (addresses: string[]): Set<string> =>
  new Set(addresses.map((address) => normalizeAddressNoPrefix(address)));

export const normalizeAddressValue = (address: unknown): string =>
  normalizeAddressNoPrefix(String(address ?? ""));

export const normalizeTrimmedAddressValue = (address: unknown): string =>
  normalizeAddressNoPrefix(String(address ?? "").trim());
