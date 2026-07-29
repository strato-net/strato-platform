import { cirrus } from "../../infra/http/api";
import { config } from "../../infra/config/runtimeConfig";
import { logInfo } from "../../infra/observability/logger";
import { retryWithBackoff } from "../../infra/http/retry.policy";
import { UserActivityInfo } from "../../shared/types";
import {
  collectDirectPayoutEventsForToken,
  resolveDirectPayoutEventsByToken,
} from "./directPayout.resolver";
import {
  getMappingRowKeyParts,
  parseMappingRowValue,
  toBigIntOrZero,
} from "./mappingRow.parser";
import { normalizeAddressSet, normalizeTrimmedAddressValue } from "./addressNormalization";

const CIRRUS_RETRY_OPTS = { maxAttempts: 3, initialDelay: 5000, maxDelay: 5000 };

export const getUserEmissionRates = async (
  users: string[],
  bonusTokenAddresses: string[] = []
): Promise<{
  rateByUser: Map<string, bigint>;
  bonusEventByToken: Map<string, string>;
  activityBreakdownByUser: Map<string, UserActivityInfo[]>;
}> => {
  if (users.length === 0 && bonusTokenAddresses.length === 0) {
    return { rateByUser: new Map(), bonusEventByToken: new Map(), activityBreakdownByUser: new Map() };
  }

  const rewardsAddress = config.rewards.address;
  const mappingRows = await retryWithBackoff(
    () => cirrus.get("/mapping", {
      params: {
        address: `eq.${rewardsAddress}`,
        collection_name: "in.(activities,activityStates,userInfo)",
        select: "collection_name,key,value",
      },
    }),
    "CirrusService-getUserEmissionRates",
    CIRRUS_RETRY_OPTS
  );

  const targetUsers = new Set(users.map((u) => u.toLowerCase()));
  const requestedBonusTokens = normalizeAddressSet(bonusTokenAddresses);
  const emissionByActivity = new Map<string, bigint>();
  const totalStakeByActivity = new Map<string, bigint>();
  const activityNameById = new Map<string, string>();
  const activityTypeById = new Map<string, string>();
  const sourceContractByActivity = new Map<string, string>();
  const directPayoutEventsByToken = new Map<string, Set<string>>();
  const userRows: Array<{ user: string; activityId: string; stake: bigint }> = [];
  const rateByUser = new Map<string, bigint>();
  const activityBreakdownByUser = new Map<string, UserActivityInfo[]>();

  if (Array.isArray(mappingRows)) {
    for (const row of mappingRows) {
      const collectionName = String(row.collection_name ?? "");
      const { key1, key2 } = getMappingRowKeyParts(row.key);
      const value = parseMappingRowValue(row.value);

      if (collectionName === "activities") {
        if (key1.length > 0) {
          emissionByActivity.set(key1, toBigIntOrZero(value.emissionRate));
          activityNameById.set(key1, String(value.name ?? ""));
          const rawType = String(value.activityType ?? "0");
          activityTypeById.set(key1, (rawType === "OneTime" || rawType === "1") ? "1" : "0");
          sourceContractByActivity.set(key1, normalizeTrimmedAddressValue(value.sourceContract));
        }

        const sourceContract = normalizeTrimmedAddressValue(value.sourceContract);
        collectDirectPayoutEventsForToken(
          directPayoutEventsByToken,
          requestedBonusTokens,
          sourceContract,
          value.directPayout,
          value.actionableEvents
        );
        continue;
      }

      if (collectionName === "activityStates") {
        if (key1.length > 0) {
          totalStakeByActivity.set(key1, toBigIntOrZero(value.totalStake));
        }
        continue;
      }

      if (collectionName === "userInfo") {
        const user = key1;
        const activityId = key2;
        if (user.length === 0 || activityId.length === 0 || !targetUsers.has(user.toLowerCase())) {
          continue;
        }

        const stake = toBigIntOrZero(value.stake);
        if (stake <= 0n) continue;
        userRows.push({ user, activityId, stake });
      }
    }
  }

  for (const { user, activityId, stake } of userRows) {
    const emissionRate = emissionByActivity.get(activityId) ?? 0n;
    const totalStake = totalStakeByActivity.get(activityId) ?? 0n;
    if (emissionRate <= 0n || totalStake <= 0n) continue;

    const personalRate = (stake * emissionRate) / totalStake;
    rateByUser.set(user, (rateByUser.get(user) ?? 0n) + personalRate);

    const activities = activityBreakdownByUser.get(user) ?? [];
    activities.push({
      activityId,
      activityName: activityNameById.get(activityId) ?? "",
      activityType: activityTypeById.get(activityId) ?? "0",
      sourceContract: sourceContractByActivity.get(activityId) ?? "",
      personalEmissionRate: personalRate,
      userStake: stake,
      totalStake,
    });
    activityBreakdownByUser.set(user, activities);
  }

  const bonusEventByToken = resolveDirectPayoutEventsByToken(
    requestedBonusTokens,
    directPayoutEventsByToken
  );

  logInfo("CirrusService", `Computed emission rates for ${rateByUser.size}/${users.length} users`);
  return { rateByUser, bonusEventByToken, activityBreakdownByUser };
};
