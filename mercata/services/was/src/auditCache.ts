import {
  WithdrawalAuditRouteType,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditTrace,
} from "@mercata/shared-types";
import {
  AuditCacheKeyParts,
  CachedWithdrawalAudit,
  WithdrawalAuditCache,
} from "./types";

export const buildAuditCacheKey = (parts: AuditCacheKeyParts): string =>
  [
    parts.routeType,
    parts.withdrawalId,
    parts.bridgeStatus,
    parts.timestamp || "unknown",
    `maxDepth=${parts.maxDepth ?? "none"}`,
  ].join(":");

const isStatusGroupMatch = (
  bridgeStatus: string,
  statusGroup: WithdrawalAuditStatusGroup,
): boolean => {
  if (statusGroup === "complete") return bridgeStatus === "3";
  if (statusGroup === "aborted") return bridgeStatus === "4";
  return bridgeStatus !== "3" && bridgeStatus !== "4";
};

const sortNewestFirst = (
  a: CachedWithdrawalAudit,
  b: CachedWithdrawalAudit,
): number =>
  Date.parse(b.trace.updatedAt || "0") - Date.parse(a.trace.updatedAt || "0");

export const createWithdrawalAuditCache = (): WithdrawalAuditCache => {
  const records = new Map<string, CachedWithdrawalAudit>();

  return {
    get: (key: string) => records.get(key),

    getLatest: (
      routeType: WithdrawalAuditRouteType,
      withdrawalId: string,
      maxDepth?: number,
    ) =>
      Array.from(records.values())
        .filter(
          ({ keyParts }) =>
            keyParts.routeType === routeType &&
            keyParts.withdrawalId === withdrawalId &&
            keyParts.maxDepth === maxDepth,
        )
        .sort(sortNewestFirst)[0],

    set: (keyParts: AuditCacheKeyParts, trace: WithdrawalAuditTrace) => {
      const key = buildAuditCacheKey(keyParts);
      records.set(key, { key, keyParts, trace });
    },

    listRecent: (
      statusGroup: WithdrawalAuditStatusGroup,
      limit: number,
      maxDepth?: number,
    ) =>
      Array.from(records.values())
        .filter(
          ({ keyParts, trace }) =>
            keyParts.maxDepth === maxDepth &&
            trace.status === "complete" &&
            isStatusGroupMatch(String(keyParts.bridgeStatus), statusGroup),
        )
        .sort(sortNewestFirst)
        .slice(0, limit),

    size: () => records.size,
  };
};
