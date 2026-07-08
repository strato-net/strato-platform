import {
  WithdrawalAuditListResponse,
  WithdrawalAuditStatusGroup,
  WithdrawalAuditRouteType,
} from "@mercata/shared-types";
import { logError, logInfo } from "./logger";
import {
  AuditCacheKeyParts,
  ProvenanceEngine,
  WarmAuditCacheRequest,
  WarmAuditCacheResult,
  WasConfig,
  WithdrawalAuditCache,
  WithdrawalAuditService,
  WithdrawalCandidateRepository,
} from "./types";

const MAX_RECENT_AUDITS = 10;
const STATUS_GROUPS: WithdrawalAuditStatusGroup[] = [
  "initiated",
  "pending-review",
  "complete",
  "aborted",
];

const clampLimit = (limit: number | undefined): number => {
  if (!limit || !Number.isSafeInteger(limit) || limit < 1) return 10;
  return Math.min(limit, MAX_RECENT_AUDITS);
};

const cacheKeyPartsFor = (
  withdrawal: AuditCacheKeyParts,
): AuditCacheKeyParts => withdrawal;

const selectStatusGroups = (
  request: WarmAuditCacheRequest | undefined,
  config: WasConfig,
): WithdrawalAuditStatusGroup[] => {
  if (request?.statusGroups?.length) return request.statusGroups;
  if (config.includeTerminalWithdrawals) return STATUS_GROUPS;
  return ["initiated", "pending-review"];
};

export const createWithdrawalAuditService = (
  config: WasConfig,
  cache: WithdrawalAuditCache,
  repository: WithdrawalCandidateRepository,
  provenanceEngine: ProvenanceEngine,
): WithdrawalAuditService => {
  let warming = false;

  const warmStatusGroup = async (
    statusGroup: WithdrawalAuditStatusGroup,
    limit: number,
    maxDepth: number | undefined,
  ): Promise<number> => {
    logInfo("AuditService", `Warming cache for ${statusGroup} withdrawals`);
    const candidates = await repository.fetchWithdrawalCandidates(
      statusGroup,
      limit,
    );
    logInfo("AuditService", `Fetched candidates for ${statusGroup}`, {
      candidates: candidates.length,
    });

    let completed = 0;
    for (const withdrawal of candidates) {
      if (completed >= limit) break;

      logInfo("AuditService", "Trace started", {
        withdrawal: `${withdrawal.routeType}:${withdrawal.withdrawalId}`,
      });
      const audit = await provenanceEngine.traceWithdrawal({
        withdrawal,
        maxDepth,
      });

      cache.set(
        cacheKeyPartsFor({
          routeType: withdrawal.routeType,
          withdrawalId: withdrawal.withdrawalId,
          bridgeStatus: withdrawal.bridgeStatus,
          timestamp: withdrawal.timestamp || withdrawal.blockTimestamp || "",
          maxDepth,
        }),
        audit,
      );
      completed += 1;
      logInfo("AuditService", "Trace finalized", {
        withdrawal: `${withdrawal.routeType}:${withdrawal.withdrawalId}`,
        decision: audit.decision,
      });
    }

    return completed;
  };

  return {
    getRecentAudits: async (
      limit: number,
      maxDepth: number | undefined,
      statusGroup: WithdrawalAuditStatusGroup,
    ): Promise<WithdrawalAuditListResponse> => ({
      data: cache
        .listRecent(statusGroup, clampLimit(limit), maxDepth)
        .map(({ trace }) => ({
          withdrawal: trace.withdrawal,
          audit: trace,
        })),
    }),

    getAudit: async (
      routeType: WithdrawalAuditRouteType,
      withdrawalId: string,
      maxDepth?: number,
    ) => cache.getLatest(routeType, withdrawalId, maxDepth)?.trace || null,

    warmAuditCache: async (
      request?: WarmAuditCacheRequest,
    ): Promise<WarmAuditCacheResult> => {
      if (warming) {
        return {
          started: false,
          completed: false,
          groups: { initiated: 0, "pending-review": 0, complete: 0, aborted: 0 },
          skippedReason: "warming already running",
        };
      }

      warming = true;
      const limit = clampLimit(request?.limit);
      const maxDepth = request?.maxDepth ?? config.traceMaxDepth;
      const groups: Record<WithdrawalAuditStatusGroup, number> = {
        initiated: 0,
        "pending-review": 0,
        complete: 0,
        aborted: 0,
      };

      try {
        logInfo("AuditService", "Cache warming started", {
          limit,
          maxDepth,
        });
        for (const statusGroup of selectStatusGroups(request, config)) {
          groups[statusGroup] = await warmStatusGroup(
            statusGroup,
            limit,
            maxDepth,
          );
        }

        logInfo("AuditService", "Cache warming completed", {
          groups,
          cacheSize: cache.size(),
        });
        return { started: true, completed: true, groups };
      } catch (error) {
        logError("AuditService", error as Error, { operation: "warmAuditCache" });
        throw error;
      } finally {
        warming = false;
      }
    },
  };
};
