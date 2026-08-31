import { cirrus, strato } from "../../utils/appApiHelper";
import { isMissingTableError } from "../../utils/cirrusErrors";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { castVoteOnIssue } from "./user.service";
import { getOraclePrices } from "./oracle.service";

const { Token, StratoStaking, ValidatorRegistry } = constants;
const WAD = 10n ** 18n;
const BPS_DIVISOR = 10000n;
const YEAR_SECONDS = 365n * 24n * 60n * 60n;
const MAX_UINT256 = (1n << 256n) - 1n;

// 0 = Missing, 1 = Registered (listed, not in the consensus set), 2 = Active (in the set), 3 = Kicked
export type StratoOperatorStatus = 0 | 1 | 2 | 3;

export interface StratoOperatorInfo {
  address: string;
  active: boolean;
  registryActive: boolean;
  operator: string;
  name: string;
  description: string;
  metadataURI: string;
  protocolValidatorId: string;
  validatorAddress: string;
  status: StratoOperatorStatus;
  isValidator: boolean;
  eligible: boolean;
  isWaiter: boolean;
  jailedUntil: string;
  exitReadyTime: string;
  blocksProposed: string;
  missedProposals: string;
  consecutiveMisses: string;
  commissionBps: string;
  selfBond: string;
  delegatedStake: string;
  totalStake: string;
  estimatedApy: string;
  userStake: string;
  pendingRewards: string;
  pendingFees: string;
}

export interface StratoUnbondingRequestInfo {
  id: string;
  amount: string;
  releaseTime: string;
  claimed: boolean;
  ready: boolean;
}

export interface StratoStakingInfo {
  configured: boolean;
  deployed: boolean;
  // False while the network still runs the pre-upgrade StratoStaking/ValidatorRegistry:
  // the validator-set and proposer-fee state does not exist on chain yet, so everything
  // derived from it reads as unset and the lifecycle calls that need it are refused.
  validatorSetDeployed: boolean;
  stakingAddress: string;
  validatorRegistryAddress: string;
  stratoTokenAddress: string;
  usdstTokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: string;
  walletBalance: string;
  totalUserStake: string;
  totalSelfBond: string;
  totalUnbonding: string;
  totalRewardableStake: string;
  totalRewardableStakeUsd: string;
  activeValidatorCount: string;
  rewardReserve: string;
  rewardPeriodAmount: string;
  scheduledRewardRemaining: string;
  baseRewardBps: string;
  maxCommissionBps: string;
  maxBatchSize: string;
  unbondingSeconds: string;
  periodStart: string;
  periodFinish: string;
  rewardPeriodName: string;
  rewardPeriodDescription: string;
  baseRewardRate: string;
  stakeRewardRate: string;
  estimatedApy: string;
  // validator set / consensus parameters
  minStake: string;
  minSelfBond: string;
  proposerFeeBps: string;
  maxConsecutiveMisses: string;
  jailCooldown: string;
  maxActiveValidators: string;
  hardCapActiveValidators: string;
  evictionMarginBps: string;
  maxSetMutationsPerBlock: string;
  exitNoticeSeconds: string;
  unkickCooldown: string;
  maxOperatorStakeBps: string;
  joinsPaused: boolean;
  governanceSyncEnabled: boolean;
  validatorCount: string;
  trackedUsdst: string;
  unattributedFees: string;
  totalFeesCredited: string;
  userTotalStake: string;
  userTotalStakeUsd: string;
  claimableRewards: string;
  claimableFees: string;
  totalEarned: string;
  isOperator: boolean;
  operatorAddress: string;
  operatorStatus: StratoOperatorStatus;
  operatorClaimableRewards: string;
  operatorClaimableFees: string;
  operatorPendingBaseRewards: string;
  operatorPendingCommission: string;
  operatorPendingSelfBondRewards: string;
  currentOperatorCommissionBps: string;
  validators: StratoOperatorInfo[];
  unbondingRequests: StratoUnbondingRequestInfo[];
}

export type StakeDelegationInput = {
  operator: string;
  amount: string;
};

export type AddStratoOperatorInput = {
  operator: string;
  commissionBps: string;
  name?: string;
  description?: string;
  metadataURI?: string;
  protocolValidatorId?: string;
  validatorAddress: string;
};

export type OperatorProfileInput = {
  commissionBps?: string;
  name?: string;
  description?: string;
  metadataURI?: string;
  protocolValidatorId?: string;
  validatorAddress?: string;
};

const normalizeAddress = (value: unknown): string =>
  String(value || "").toLowerCase().replace(/^0x/, "");

const parseBigIntLike = (value: unknown): bigint => {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;

  const raw = String(value).trim();
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
};

const parseBoolLike = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const raw = value.trim().toLowerCase();
    return raw === "true" || raw === "1";
  }
  return false;
};

const badRequest = (message: string): Error => {
  const error = new Error(message);
  (error as any).statusCode = 400;
  return error;
};

const formatBpsAsPercent = (bps: bigint): string => {
  if (bps <= 0n) return "0.00";
  return (Number(bps) / 100).toFixed(2);
};

const stakingAddress = (): string => normalizeAddress(constants.stratoStaking);
const validatorRegistryAddress = (): string => normalizeAddress(constants.validatorRegistry);
const stratoTokenAddress = (): string => normalizeAddress(constants.stratoToken);

const emptyInfo = (): StratoStakingInfo => ({
  configured: Boolean(stakingAddress()),
  deployed: false,
  validatorSetDeployed: false,
  stakingAddress: stakingAddress(),
  validatorRegistryAddress: validatorRegistryAddress(),
  stratoTokenAddress: stratoTokenAddress(),
  usdstTokenAddress: "",
  tokenName: "STRATO",
  tokenSymbol: "STRATO",
  tokenDecimals: "18",
  walletBalance: "0",
  totalUserStake: "0",
  totalSelfBond: "0",
  totalUnbonding: "0",
  totalRewardableStake: "0",
  totalRewardableStakeUsd: "0",
  activeValidatorCount: "0",
  rewardReserve: "0",
  rewardPeriodAmount: "0",
  scheduledRewardRemaining: "0",
  baseRewardBps: "0",
  maxCommissionBps: "0",
  maxBatchSize: "0",
  unbondingSeconds: "0",
  periodStart: "0",
  periodFinish: "0",
  rewardPeriodName: "",
  rewardPeriodDescription: "",
  baseRewardRate: "0",
  stakeRewardRate: "0",
  estimatedApy: "-",
  minStake: "0",
  minSelfBond: "0",
  proposerFeeBps: "0",
  maxConsecutiveMisses: "0",
  jailCooldown: "0",
  maxActiveValidators: "0",
  hardCapActiveValidators: "0",
  evictionMarginBps: "0",
  maxSetMutationsPerBlock: "0",
  exitNoticeSeconds: "0",
  unkickCooldown: "0",
  maxOperatorStakeBps: "0",
  joinsPaused: true,
  governanceSyncEnabled: false,
  validatorCount: "0",
  trackedUsdst: "0",
  unattributedFees: "0",
  totalFeesCredited: "0",
  userTotalStake: "0",
  userTotalStakeUsd: "0",
  claimableRewards: "0",
  claimableFees: "0",
  totalEarned: "0",
  isOperator: false,
  operatorAddress: "",
  operatorStatus: 0,
  operatorClaimableRewards: "0",
  operatorClaimableFees: "0",
  operatorPendingBaseRewards: "0",
  operatorPendingCommission: "0",
  operatorPendingSelfBondRewards: "0",
  currentOperatorCommissionBps: "0",
  validators: [],
  unbondingRequests: [],
});

const requireStakingAddress = (): string => {
  const address = stakingAddress();
  if (!address) {
    throw new Error("STRATO_STAKING is not configured");
  }
  return address;
};

const requireValidatorRegistryAddress = (): string => {
  const address = validatorRegistryAddress();
  if (!address) {
    throw new Error("VALIDATOR_REGISTRY is not configured");
  }
  return address;
};

const requireStratoTokenAddress = (): string => {
  const address = stratoTokenAddress();
  if (!address) {
    throw new Error("STRATO token is not configured");
  }
  return address;
};

// Contract state columns that exist on every deployed StratoStaking.
const BASE_STATE_COLUMNS = [
  "address",
  "stratoToken",
  "unbondingSeconds::text",
  "baseRewardBps::text",
  "maxCommissionBps::text",
  "maxBatchSize::text",
  "totalUserStake::text",
  "totalSelfBond::text",
  "totalUnbonding::text",
  "totalRewardableStake::text",
  "activeOperatorCount::text",
  "rewardReserve::text",
  "rewardPeriodAmount::text",
  "scheduledRewardRemaining::text",
  "baseRewardRate::text",
  "stakeRewardRate::text",
  "periodStart::text",
  "periodFinish::text",
  "rewardPeriodName",
  "rewardPeriodDescription",
  "lastUpdateTime::text",
  "baseRewardPerOperatorStored::text",
  "globalStakeRewardPerTokenStored::text",
];

// Columns added by the validator-set / proposer-fee staking upgrade. A network still
// running the previous contract has none of them, and PostgREST fails the *whole*
// select with 42703 (undefined_column) rather than omitting the unknown names — which
// is why they are asked for separately and default to unset when the read is refused.
const VALIDATOR_SET_STATE_COLUMNS = [
  "usdstToken",
  "governanceSyncEnabled",
  "minStake::text",
  "minSelfBond::text",
  "proposerFeeBps::text",
  "maxConsecutiveMisses::text",
  "jailCooldown::text",
  "maxActiveValidators::text",
  "hardCapActiveValidators::text",
  "evictionMarginBps::text",
  "maxSetMutationsPerBlock::text",
  "exitNoticeSeconds::text",
  "unkickCooldown::text",
  "maxOperatorStakeBps::text",
  "joinsPaused",
  "validatorCount::text",
  "trackedUsdst::text",
  "unattributedFees::text",
  "totalFeesCredited::text",
];

type StakingContractState = {
  state: Record<string, any>;
  validatorSetDeployed: boolean;
};

// Once the upgrade columns are known to be absent, skip the doomed select for a while
// rather than paying two Cirrus round trips on every request; re-probe after the TTL
// so the upgrade is picked up without restarting the API.
const VALIDATOR_SET_PROBE_TTL_MS = 5 * 60 * 1000;
let validatorSetColumnsMissingUntil = 0;

const getContractState = async (accessToken: string): Promise<StakingContractState | null> => {
  const address = stakingAddress();
  if (!address) return null;

  const read = async (includeValidatorSet: boolean): Promise<Record<string, any> | null> => {
    const columns = includeValidatorSet
      ? [...BASE_STATE_COLUMNS, ...VALIDATOR_SET_STATE_COLUMNS]
      : BASE_STATE_COLUMNS;

    const { data } = await cirrus.get(accessToken, `/${StratoStaking}`, {
      params: {
        address: `eq.${address}`,
        select: columns.join(","),
      },
    });

    return data?.[0] || null;
  };

  if (Date.now() >= validatorSetColumnsMissingUntil) {
    try {
      const state = await read(true);
      validatorSetColumnsMissingUntil = 0;
      return state ? { state, validatorSetDeployed: true } : null;
    } catch (error) {
      // Only a missing column means "not upgraded yet"; anything else is a real
      // failure and must not be retried as a narrower read.
      if (!isMissingTableError(error)) return null;
      validatorSetColumnsMissingUntil = Date.now() + VALIDATOR_SET_PROBE_TTL_MS;
    }
  }

  try {
    const state = await read(false);
    return state ? { state, validatorSetDeployed: false } : null;
  } catch {
    return null;
  }
};

const getTokenInfo = async (
  accessToken: string,
  tokenAddress: string
): Promise<{ tokenName: string; tokenSymbol: string; tokenDecimals: string }> => {
  if (!tokenAddress) {
    return { tokenName: "STRATO", tokenSymbol: "STRATO", tokenDecimals: "18" };
  }

  try {
    const { data } = await cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `eq.${tokenAddress}`,
        select: "_name,_symbol,customDecimals",
      },
    });

    const token = data?.[0] || {};
    return {
      tokenName: token._name || "STRATO",
      tokenSymbol: token._symbol || "STRATO",
      tokenDecimals: String(token.customDecimals ?? "18"),
    };
  } catch {
    return { tokenName: "STRATO", tokenSymbol: "STRATO", tokenDecimals: "18" };
  }
};

const getTokenBalance = async (
  accessToken: string,
  tokenAddress: string,
  userAddress?: string
): Promise<string> => {
  const user = normalizeAddress(userAddress);
  if (!tokenAddress || !user) return "0";

  try {
    const { data } = await cirrus.get(accessToken, `/${Token}-_balances`, {
      params: {
        address: `eq.${tokenAddress}`,
        key: `eq.${user}`,
        select: "value::text",
      },
    });

    return data?.[0]?.value || "0";
  } catch {
    return "0";
  }
};

const getTokenAllowance = async (
  accessToken: string,
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string
): Promise<bigint> => {
  const token = normalizeAddress(tokenAddress);
  const owner = normalizeAddress(ownerAddress);
  const spender = normalizeAddress(spenderAddress);
  if (!token || !owner || !spender) return 0n;

  try {
    const { data } = await cirrus.get(accessToken, `/${Token}-_allowances`, {
      params: {
        address: `eq.${token}`,
        key: `eq.${owner}`,
        key2: `eq.${spender}`,
        select: "value::text",
      },
    });

    return parseBigIntLike(data?.[0]?.value);
  } catch {
    return 0n;
  }
};

// STRATO oracle price (WAD); used to express network stake as USD TVL. Reads
// through getOraclePrices so it always agrees with the portfolio price map.
const getStratoTokenPriceWad = async (accessToken: string): Promise<bigint> => {
  const token = stratoTokenAddress();
  if (!token) return 0n;

  try {
    const prices = await getOraclePrices(accessToken, {
      key: `eq.${token}`,
      select: "asset:key,price:value::text",
    });
    return parseBigIntLike(prices.get(token));
  } catch {
    return 0n;
  }
};

const getOperatorRows = async (accessToken: string): Promise<Array<{ key: string; value: Record<string, any> }>> => {
  const address = stakingAddress();
  if (!address) return [];

  try {
    const { data } = await cirrus.get(accessToken, `/${StratoStaking}-operators`, {
      params: {
        address: `eq.${address}`,
        select: "key,value",
        order: "key.asc",
        limit: "500",
      },
    });

    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

const getValidatorProfiles = async (accessToken: string): Promise<Map<string, Record<string, any>>> => {
  const address = validatorRegistryAddress();
  const profiles = new Map<string, Record<string, any>>();
  if (!address) return profiles;

  try {
    const { data } = await cirrus.get(accessToken, `/${ValidatorRegistry}-operators`, {
      params: {
        address: `eq.${address}`,
        select: "key,value",
        limit: "500",
      },
    });

    for (const row of data || []) {
      const operator = normalizeAddress(row.key);
      if (operator) profiles.set(operator, row.value || {});
    }
  } catch {
    return profiles;
  }

  return profiles;
};

// Single-key mappings of the staking contract keyed by an address (operator or
// validator): isValidator, jailedUntil, exitReadyTime, blocksProposed, ...
const getAddressMap = async (accessToken: string, table: string): Promise<Map<string, string>> => {
  const address = stakingAddress();
  const values = new Map<string, string>();
  if (!address) return values;

  try {
    const { data } = await cirrus.get(accessToken, `/${StratoStaking}-${table}`, {
      params: {
        address: `eq.${address}`,
        select: "key,value::text",
        limit: "500",
      },
    });

    for (const row of data || []) {
      const key = normalizeAddress(row.key);
      if (key) values.set(key, String(row.value ?? ""));
    }
  } catch {
    return values;
  }

  return values;
};

const getUserMap = async (
  accessToken: string,
  table: string,
  userAddress?: string
): Promise<Map<string, bigint>> => {
  const address = stakingAddress();
  const user = normalizeAddress(userAddress);
  const values = new Map<string, bigint>();
  if (!address || !user) return values;

  try {
    const { data } = await cirrus.get(accessToken, `/${StratoStaking}-${table}`, {
      params: {
        address: `eq.${address}`,
        key: `eq.${user}`,
        select: "key,key2,value::text",
        limit: "500",
      },
    });

    for (const row of data || []) {
      const operator = normalizeAddress(row.key2);
      if (operator) values.set(operator, parseBigIntLike(row.value));
    }
  } catch {
    return values;
  }

  return values;
};

const getUnbondingRequests = async (
  accessToken: string,
  userAddress?: string
): Promise<StratoUnbondingRequestInfo[]> => {
  const address = stakingAddress();
  const user = normalizeAddress(userAddress);
  if (!address || !user) return [];

  try {
    const { data } = await cirrus.get(accessToken, `/${StratoStaking}-unbondingQueue`, {
      params: {
        address: `eq.${address}`,
        key: `eq.${user}`,
        select: "key,key2,value",
        order: "key2.asc",
        limit: "500",
      },
    });

    const now = Math.floor(Date.now() / 1000);
    return (data || []).map((row: any) => {
      const value = row.value || {};
      const releaseTime = String(value.releaseTime || "0");
      const claimed = parseBoolLike(value.claimed);

      return {
        id: String(row.key2),
        amount: String(value.amount || "0"),
        releaseTime,
        claimed,
        ready: !claimed && Number(releaseTime) <= now,
      };
    });
  } catch {
    return [];
  }
};

// Total STRATO the user has locked in the staking contract: delegated stake,
// operator self-bond, and unclaimed unbonding amounts. Consumed by the tokens
// service so staked STRATO stays visible in portfolio balances.
export const getUserStakedStratoBalance = async (
  accessToken: string,
  userAddress?: string
): Promise<{ tokenAddress: string; amount: bigint }> => {
  const address = stakingAddress();
  const user = normalizeAddress(userAddress);
  const tokenAddress = stratoTokenAddress();
  if (!address || !user || !tokenAddress) return { tokenAddress, amount: 0n };

  const [delegations, operatorRows, unbondingRequests] = await Promise.all([
    getUserMap(accessToken, "delegatedStake", user),
    cirrus.get(accessToken, `/${StratoStaking}-operators`, {
      params: { address: `eq.${address}`, key: `eq.${user}`, select: "value" },
    }).catch(() => ({ data: [] })),
    getUnbondingRequests(accessToken, user),
  ]);

  let amount = 0n;
  for (const stake of delegations.values()) amount += stake;
  amount += parseBigIntLike((operatorRows.data?.[0]?.value || {}).selfBond);
  for (const request of unbondingRequests) {
    if (!request.claimed) amount += parseBigIntLike(request.amount);
  }

  return { tokenAddress, amount };
};

// Lifetime claimed rewards (delegator and operator), summed from Cirrus events.
// Combined with current claimable rewards this gives total earned through staking.
const getLifetimeClaimedRewards = async (
  accessToken: string,
  userAddress?: string
): Promise<bigint> => {
  const address = stakingAddress();
  const user = normalizeAddress(userAddress);
  if (!address || !user) return 0n;

  try {
    const { data } = await cirrus.get(accessToken, `/${constants.Event}`, {
      params: {
        address: `eq.${address}`,
        or: `(and(event_name.eq.DelegatorRewardsClaimed,attributes->>user.eq.${user}),and(event_name.eq.OperatorRewardsClaimed,attributes->>operator.eq.${user}))`,
        select: "amount:attributes->>amount",
        limit: "1000",
      },
    });

    return (data || []).reduce(
      (sum: bigint, row: any) => sum + parseBigIntLike(row.amount),
      0n
    );
  } catch {
    return 0n;
  }
};

const projectedRewardIndexes = (state: Record<string, any>): {
  baseIndex: bigint;
  stakeIndex: bigint;
  rewardReserve: bigint;
  scheduledRewardRemaining: bigint;
  baseRewardRate: bigint;
  stakeRewardRate: bigint;
} => {
  let baseIndex = parseBigIntLike(state.baseRewardPerOperatorStored);
  let stakeIndex = parseBigIntLike(state.globalStakeRewardPerTokenStored);
  let rewardReserve = parseBigIntLike(state.rewardReserve);
  let scheduledRewardRemaining = parseBigIntLike(state.scheduledRewardRemaining);
  let baseRewardRate = parseBigIntLike(state.baseRewardRate);
  let stakeRewardRate = parseBigIntLike(state.stakeRewardRate);
  const periodStart = Number(state.periodStart || 0);
  const periodFinish = Number(state.periodFinish || 0);
  const lastUpdateTime = Number(state.lastUpdateTime || 0);
  const now = Math.floor(Date.now() / 1000);
  const current = Math.min(now, periodFinish);

  const finishScheduleIfEnded = () => {
    if (periodFinish > 0 && now >= periodFinish) {
      baseRewardRate = 0n;
      stakeRewardRate = 0n;
      scheduledRewardRemaining = 0n;
    }
  };

  if (!current || now < periodStart || current <= lastUpdateTime) {
    finishScheduleIfEnded();
    return { baseIndex, stakeIndex, rewardReserve, scheduledRewardRemaining, baseRewardRate, stakeRewardRate };
  }

  const activeOperatorCount = parseBigIntLike(state.activeOperatorCount);
  const totalRewardableStake = parseBigIntLike(state.totalRewardableStake);
  const delta = BigInt(current - lastUpdateTime);

  if (baseRewardRate > 0n && activeOperatorCount > 0n && scheduledRewardRemaining > 0n) {
    let baseAccrued = baseRewardRate * delta;
    if (baseAccrued > scheduledRewardRemaining) baseAccrued = scheduledRewardRemaining;

    const perOperator = baseAccrued / activeOperatorCount;
    const allocatedBase = perOperator * activeOperatorCount;
    if (allocatedBase > 0n) {
      baseIndex += perOperator;
      rewardReserve = rewardReserve > allocatedBase ? rewardReserve - allocatedBase : 0n;
      scheduledRewardRemaining -= allocatedBase;
    }
  }

  if (stakeRewardRate > 0n && totalRewardableStake > 0n && scheduledRewardRemaining > 0n) {
    let stakeAccrued = stakeRewardRate * delta;
    if (stakeAccrued > scheduledRewardRemaining) stakeAccrued = scheduledRewardRemaining;

    const rewardPerStake = (stakeAccrued * WAD) / totalRewardableStake;
    const allocatedStake = (rewardPerStake * totalRewardableStake) / WAD;

    if (allocatedStake > 0n) {
      stakeIndex += rewardPerStake;
      rewardReserve = rewardReserve > allocatedStake ? rewardReserve - allocatedStake : 0n;
      scheduledRewardRemaining -= allocatedStake;
    }
  }

  if (current === periodFinish && now >= periodFinish) {
    baseRewardRate = 0n;
    stakeRewardRate = 0n;
    scheduledRewardRemaining = 0n;
  } else if (scheduledRewardRemaining === 0n) {
    baseRewardRate = 0n;
    stakeRewardRate = 0n;
  }

  return { baseIndex, stakeIndex, rewardReserve, scheduledRewardRemaining, baseRewardRate, stakeRewardRate };
};

const projectedOperatorRewards = (
  operator: Record<string, any>,
  currentIndexes: { baseIndex: bigint; stakeIndex: bigint }
): { base: bigint; selfBond: bigint; commission: bigint } => {
  let base = parseBigIntLike(operator.pendingBaseRewards);
  let selfBondReward = parseBigIntLike(operator.pendingSelfBondRewards);
  let commission = parseBigIntLike(operator.pendingCommission);

  if (!parseBoolLike(operator.active)) {
    return { base, selfBond: selfBondReward, commission };
  }

  const basePaid = parseBigIntLike(operator.baseRewardPerOperatorPaid);
  if (currentIndexes.baseIndex > basePaid) {
    base += currentIndexes.baseIndex - basePaid;
  }

  const stakePaid = parseBigIntLike(operator.stakeRewardPerTokenPaid);
  if (currentIndexes.stakeIndex > stakePaid) {
    const stakeDelta = currentIndexes.stakeIndex - stakePaid;
    const selfBond = parseBigIntLike(operator.selfBond);
    const delegatedStake = parseBigIntLike(operator.delegatedStake);

    selfBondReward += (selfBond * stakeDelta) / WAD;

    const userGross = (delegatedStake * stakeDelta) / WAD;
    commission += (userGross * parseBigIntLike(operator.commissionBps)) / BPS_DIVISOR;
  }

  return { base, selfBond: selfBondReward, commission };
};

const projectedDelegatorIndex = (
  operator: Record<string, any>,
  currentStakeIndex: bigint
): bigint => {
  const stored = parseBigIntLike(operator.delegatorRewardPerStakeStored);
  if (!parseBoolLike(operator.active)) return stored;

  const paid = parseBigIntLike(operator.stakeRewardPerTokenPaid);
  const delegatedStake = parseBigIntLike(operator.delegatedStake);
  if (currentStakeIndex <= paid || delegatedStake <= 0n) return stored;

  const stakeDelta = currentStakeIndex - paid;
  const userGross = (delegatedStake * stakeDelta) / WAD;
  const commission = (userGross * parseBigIntLike(operator.commissionBps)) / BPS_DIVISOR;
  const userNet = userGross - commission;

  return stored + ((userNet * WAD) / delegatedStake);
};

const validatorApyBps = (
  state: Record<string, any>,
  commissionBps: bigint,
  stakeRewardRate: bigint
): bigint => {
  const totalRewardableStake = parseBigIntLike(state.totalRewardableStake);
  if (totalRewardableStake <= 0n) return 0n;

  const now = Math.floor(Date.now() / 1000);
  const periodFinish = Number(state.periodFinish || 0);
  if (!periodFinish || now >= periodFinish) return 0n;

  const grossBps = (stakeRewardRate * YEAR_SECONDS * BPS_DIVISOR) / totalRewardableStake;
  const netCommissionBps = commissionBps >= BPS_DIVISOR ? BPS_DIVISOR : commissionBps;
  return (grossBps * (BPS_DIVISOR - netCommissionBps)) / BPS_DIVISOR;
};

// Best available net APY across active validators — matches the "Best
// Available APY" convention used on the Earn page. Consumed by the earn
// service so the portfolio STRATO row can show combined native + rewards APY.
export const getStratoStakingNetworkApy = async (accessToken: string): Promise<string | null> => {
  const contractState = await getContractState(accessToken);
  if (!contractState) return null;

  const { state } = contractState;
  const currentIndexes = projectedRewardIndexes(state);
  const operatorRows = await getOperatorRows(accessToken);

  let bestBps = 0n;
  for (const row of operatorRows) {
    const value = row.value || {};
    if (!parseBoolLike(value.active)) continue;
    const apyBps = validatorApyBps(state, parseBigIntLike(value.commissionBps), currentIndexes.stakeRewardRate);
    if (apyBps > bestBps) bestBps = apyBps;
  }

  return bestBps > 0n ? formatBpsAsPercent(bestBps) : null;
};

export const getStratoStakingInfo = async (
  accessToken: string,
  userAddress?: string
): Promise<StratoStakingInfo> => {
  const contractState = await getContractState(accessToken);
  if (!contractState) return emptyInfo();

  const { state, validatorSetDeployed } = contractState;
  const tokenAddress = normalizeAddress(state.stratoToken) || stratoTokenAddress();
  const currentIndexes = projectedRewardIndexes(state);

  // Mapping tables that only exist once the upgrade is deployed; asking for them on the
  // older contract is a guaranteed 42P01, so they resolve empty without a round trip.
  const noAddressMap = (): Promise<Map<string, string>> => Promise.resolve(new Map());
  const noUserMap = (): Promise<Map<string, bigint>> => Promise.resolve(new Map());

  const [
    tokenInfo,
    walletBalance,
    operatorRows,
    userDelegatedStake,
    userPendingRewards,
    userRewardPaid,
    userPendingFees,
    userFeePaid,
    unbondingRequests,
    validatorProfiles,
    lifetimeClaimedRewards,
    stratoPriceWad,
    validatorFlags,
    jailedUntilMap,
    exitReadyMap,
    blocksProposedMap,
    missedProposalsMap,
    consecutiveMissesMap,
  ] = await Promise.all([
    getTokenInfo(accessToken, tokenAddress),
    getTokenBalance(accessToken, tokenAddress, userAddress),
    getOperatorRows(accessToken),
    getUserMap(accessToken, "delegatedStake", userAddress),
    getUserMap(accessToken, "pendingDelegatorRewards", userAddress),
    getUserMap(accessToken, "userRewardPerStakePaid", userAddress),
    validatorSetDeployed ? getUserMap(accessToken, "pendingDelegatorFees", userAddress) : noUserMap(),
    validatorSetDeployed ? getUserMap(accessToken, "userFeePerStakePaid", userAddress) : noUserMap(),
    getUnbondingRequests(accessToken, userAddress),
    getValidatorProfiles(accessToken),
    getLifetimeClaimedRewards(accessToken, userAddress),
    getStratoTokenPriceWad(accessToken),
    validatorSetDeployed ? getAddressMap(accessToken, "isValidator") : noAddressMap(),
    validatorSetDeployed ? getAddressMap(accessToken, "jailedUntil") : noAddressMap(),
    validatorSetDeployed ? getAddressMap(accessToken, "exitReadyTime") : noAddressMap(),
    validatorSetDeployed ? getAddressMap(accessToken, "blocksProposed") : noAddressMap(),
    validatorSetDeployed ? getAddressMap(accessToken, "missedProposals") : noAddressMap(),
    validatorSetDeployed ? getAddressMap(accessToken, "consecutiveMisses") : noAddressMap(),
  ] as const);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const minStake = parseBigIntLike(state.minStake);
  const minSelfBond = parseBigIntLike(state.minSelfBond);

  let userTotalStake = 0n;
  let claimableRewards = 0n;
  let claimableFees = 0n;
  let userWeightedApyBps = 0n;
  let bestActiveApyBps = 0n;
  let isOperator = false;
  let connectedOperatorAddress = "";
  let operatorStatus: StratoOperatorStatus = 0;
  let operatorPendingBaseRewards = 0n;
  let operatorPendingCommission = 0n;
  let operatorPendingSelfBondRewards = 0n;
  let operatorPendingFees = 0n;
  let currentOperatorCommissionBps = 0n;
  const normalizedUserAddress = normalizeAddress(userAddress);

  const validators = operatorRows.map((row) => {
    const operatorAddress = normalizeAddress(row.key);
    const value = row.value || {};
    const profile = validatorProfiles.get(operatorAddress) || {};
    const commissionBps = parseBigIntLike(value.commissionBps);
    const selfBond = parseBigIntLike(value.selfBond);
    const delegatedStake = parseBigIntLike(value.delegatedStake);
    const totalStake = selfBond + delegatedStake;
    const userStake = userDelegatedStake.get(operatorAddress) || 0n;
    const pendingStored = userPendingRewards.get(operatorAddress) || 0n;
    const paid = userRewardPaid.get(operatorAddress) || 0n;
    const projectedIndex = projectedDelegatorIndex(value, currentIndexes.stakeIndex);
    const projectedReward = userStake > 0n && projectedIndex > paid
      ? (userStake * (projectedIndex - paid)) / WAD
      : 0n;
    const pendingRewards = pendingStored + projectedReward;
    // Proposer fees (USDST) are pushed per block, so no time projection is needed.
    const feeIndex = parseBigIntLike(value.feePerStakeStored);
    const feePaid = userFeePaid.get(operatorAddress) || 0n;
    const pendingFees = (userPendingFees.get(operatorAddress) || 0n)
      + (userStake > 0n && feeIndex > feePaid ? (userStake * (feeIndex - feePaid)) / WAD : 0n);
    const apyBps = validatorApyBps(state, commissionBps, currentIndexes.stakeRewardRate);
    const operatorRewards = projectedOperatorRewards(value, currentIndexes);

    const active = parseBoolLike(value.active);
    // Before the upgrade there is no validatorAddress on the profile and no isValidator
    // map on the staking contract: an operator's `active` flag *is* its consensus-set
    // membership, so deriving the status from it keeps the badges honest meanwhile.
    const validatorAddress = normalizeAddress(profile.validatorAddress);
    const isValidator = validatorSetDeployed
      ? parseBoolLike(validatorFlags.get(operatorAddress))
      : active;
    const jailedUntil = parseBigIntLike(jailedUntilMap.get(operatorAddress));
    const exitReadyTime = parseBigIntLike(exitReadyMap.get(operatorAddress));
    const status: StratoOperatorStatus = !active ? 3 : isValidator ? 2 : 1;
    const eligible = active
      && (!validatorSetDeployed || Boolean(validatorAddress))
      && totalStake >= minStake && selfBond >= minSelfBond
      && now >= jailedUntil && (exitReadyTime === 0n || now < exitReadyTime);

    if (operatorAddress && operatorAddress === normalizedUserAddress) {
      isOperator = true;
      connectedOperatorAddress = operatorAddress;
      operatorStatus = status;
      operatorPendingBaseRewards = operatorRewards.base;
      operatorPendingCommission = operatorRewards.commission;
      operatorPendingSelfBondRewards = operatorRewards.selfBond;
      operatorPendingFees = parseBigIntLike(value.pendingSelfBondFees) + parseBigIntLike(value.pendingFeeCommission);
      currentOperatorCommissionBps = commissionBps;
    }

    if (active && apyBps > bestActiveApyBps) {
      bestActiveApyBps = apyBps;
    }

    userTotalStake += userStake;
    claimableRewards += pendingRewards;
    claimableFees += pendingFees;
    userWeightedApyBps += userStake * apyBps;

    return {
      address: operatorAddress,
      active,
      registryActive: parseBoolLike(profile.active),
      operator: operatorAddress,
      name: String(profile.name || ""),
      description: String(profile.description || ""),
      metadataURI: String(profile.metadataURI || ""),
      protocolValidatorId: String(profile.protocolValidatorId || ""),
      validatorAddress,
      status,
      isValidator,
      eligible,
      isWaiter: eligible && !isValidator,
      jailedUntil: jailedUntil.toString(),
      exitReadyTime: exitReadyTime.toString(),
      blocksProposed: parseBigIntLike(blocksProposedMap.get(validatorAddress)).toString(),
      missedProposals: parseBigIntLike(missedProposalsMap.get(validatorAddress)).toString(),
      consecutiveMisses: parseBigIntLike(consecutiveMissesMap.get(validatorAddress)).toString(),
      commissionBps: commissionBps.toString(),
      selfBond: selfBond.toString(),
      delegatedStake: delegatedStake.toString(),
      totalStake: totalStake.toString(),
      estimatedApy: formatBpsAsPercent(apyBps),
      userStake: userStake.toString(),
      pendingRewards: pendingRewards.toString(),
      pendingFees: pendingFees.toString(),
    };
  });

  // Your actual (stake-weighted) APY once you're delegated; best available
  // across active validators until then.
  const estimatedApy = userTotalStake > 0n
    ? formatBpsAsPercent(userWeightedApyBps / userTotalStake)
    : bestActiveApyBps > 0n
      ? formatBpsAsPercent(bestActiveApyBps)
      : "-";

  return {
    configured: true,
    deployed: true,
    validatorSetDeployed,
    stakingAddress: stakingAddress(),
    validatorRegistryAddress: validatorRegistryAddress(),
    stratoTokenAddress: tokenAddress,
    usdstTokenAddress: normalizeAddress(state.usdstToken),
    ...tokenInfo,
    walletBalance,
    totalUserStake: String(state.totalUserStake || "0"),
    totalSelfBond: String(state.totalSelfBond || "0"),
    totalUnbonding: String(state.totalUnbonding || "0"),
    totalRewardableStake: String(state.totalRewardableStake || "0"),
    totalRewardableStakeUsd: stratoPriceWad > 0n
      ? ((parseBigIntLike(state.totalRewardableStake) * stratoPriceWad) / WAD).toString()
      : "0",
    activeValidatorCount: String(state.activeOperatorCount || "0"),
    rewardReserve: currentIndexes.rewardReserve.toString(),
    rewardPeriodAmount: String(state.rewardPeriodAmount || "0"),
    scheduledRewardRemaining: currentIndexes.scheduledRewardRemaining.toString(),
    baseRewardBps: String(state.baseRewardBps || "0"),
    maxCommissionBps: String(state.maxCommissionBps || "0"),
    maxBatchSize: String(state.maxBatchSize || "0"),
    unbondingSeconds: String(state.unbondingSeconds || "0"),
    periodStart: String(state.periodStart || "0"),
    periodFinish: String(state.periodFinish || "0"),
    rewardPeriodName: String(state.rewardPeriodName || ""),
    rewardPeriodDescription: String(state.rewardPeriodDescription || ""),
    baseRewardRate: currentIndexes.baseRewardRate.toString(),
    stakeRewardRate: currentIndexes.stakeRewardRate.toString(),
    estimatedApy,
    minStake: minStake.toString(),
    minSelfBond: minSelfBond.toString(),
    proposerFeeBps: String(state.proposerFeeBps || "0"),
    maxConsecutiveMisses: String(state.maxConsecutiveMisses || "0"),
    jailCooldown: String(state.jailCooldown || "0"),
    maxActiveValidators: String(state.maxActiveValidators || "0"),
    hardCapActiveValidators: String(state.hardCapActiveValidators || "0"),
    evictionMarginBps: String(state.evictionMarginBps || "0"),
    maxSetMutationsPerBlock: String(state.maxSetMutationsPerBlock || "0"),
    exitNoticeSeconds: String(state.exitNoticeSeconds || "0"),
    unkickCooldown: String(state.unkickCooldown || "0"),
    maxOperatorStakeBps: String(state.maxOperatorStakeBps || "0"),
    // The older contract has no permissionless join at all, so "paused" is the honest
    // reading of an absent flag rather than the `false` a missing column would give.
    joinsPaused: validatorSetDeployed ? parseBoolLike(state.joinsPaused) : true,
    governanceSyncEnabled: parseBoolLike(state.governanceSyncEnabled),
    // Pre-upgrade the contract keeps no separate set counter; every active operator is
    // in the consensus set, which is exactly what activeOperatorCount counts.
    validatorCount: validatorSetDeployed
      ? String(state.validatorCount || "0")
      : String(state.activeOperatorCount || "0"),
    trackedUsdst: String(state.trackedUsdst || "0"),
    unattributedFees: String(state.unattributedFees || "0"),
    totalFeesCredited: String(state.totalFeesCredited || "0"),
    userTotalStake: userTotalStake.toString(),
    userTotalStakeUsd: stratoPriceWad > 0n ? ((userTotalStake * stratoPriceWad) / WAD).toString() : "0",
    claimableRewards: claimableRewards.toString(),
    claimableFees: claimableFees.toString(),
    totalEarned: (
      lifetimeClaimedRewards +
      claimableRewards +
      operatorPendingBaseRewards +
      operatorPendingCommission +
      operatorPendingSelfBondRewards
    ).toString(),
    isOperator,
    operatorAddress: connectedOperatorAddress,
    operatorStatus,
    operatorClaimableRewards: (operatorPendingBaseRewards + operatorPendingCommission + operatorPendingSelfBondRewards).toString(),
    operatorClaimableFees: operatorPendingFees.toString(),
    operatorPendingBaseRewards: operatorPendingBaseRewards.toString(),
    operatorPendingCommission: operatorPendingCommission.toString(),
    operatorPendingSelfBondRewards: operatorPendingSelfBondRewards.toString(),
    currentOperatorCommissionBps: currentOperatorCommissionBps.toString(),
    validators,
    unbondingRequests,
  };
};

const buildAndPost = async (
  accessToken: string,
  userAddress: string,
  txs: FunctionInput | FunctionInput[]
): Promise<{ status: string; hash: string }> => {
  const builtTx = await buildFunctionTx(txs, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

const batchSizeFromValue = (value: unknown): number => {
  const parsed = parseBigIntLike(value);
  if (parsed <= 0n) return 1;
  return Number(parsed > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : parsed);
};

const batchSizeFromInfo = (info: StratoStakingInfo): number => batchSizeFromValue(info.maxBatchSize);

const getMaxBatchSize = async (accessToken: string): Promise<number> => {
  const contractState = await getContractState(accessToken);
  return batchSizeFromValue(contractState?.state?.maxBatchSize);
};

// Guard for the calls the validator-set / proposer-fee upgrade introduced. Against the
// contract still deployed here they resolve to no method at all and revert inside the
// VM, so refuse them up front with something a user can act on. An unreadable contract
// state is not treated as "not upgraded": that would block staking on a Cirrus blip.
const requireValidatorSetUpgrade = async (accessToken: string): Promise<void> => {
  const contractState = await getContractState(accessToken);
  if (contractState && !contractState.validatorSetDeployed) {
    throw badRequest(
      "Validator set management is unavailable: the staking contract upgrade has not been deployed on this network yet."
    );
  }
};

const assertWithinMaxBatchSize = (count: number, maxBatchSize: number, label: string): void => {
  if (count > maxBatchSize) {
    throw badRequest(`${label} exceeds max batch size of ${maxBatchSize}`);
  }
};

const chunkByMaxBatchSize = <T>(items: T[], maxBatchSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += maxBatchSize) {
    chunks.push(items.slice(i, i + maxBatchSize));
  }
  return chunks;
};

const normalizeDelegations = (delegations: StakeDelegationInput[]): StakeDelegationInput[] => {
  const normalized = delegations
    .map((delegation) => ({
      operator: normalizeAddress(delegation.operator),
      amount: String(delegation.amount || "0"),
    }))
    .filter((delegation) => delegation.operator && parseBigIntLike(delegation.amount) > 0n);

  if (!normalized.length) {
    throw new Error("At least one delegation is required");
  }

  return normalized;
};

export const stakeStrato = async (
  accessToken: string,
  userAddress: string,
  delegations: StakeDelegationInput[]
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  const token = requireStratoTokenAddress();
  const normalized = normalizeDelegations(delegations);
  const maxBatchSize = await getMaxBatchSize(accessToken);
  assertWithinMaxBatchSize(normalized.length, maxBatchSize, "Delegations");

  const totalAmount = normalized.reduce((sum, delegation) => sum + parseBigIntLike(delegation.amount), 0n);
  const allowance = await getTokenAllowance(accessToken, token, userAddress, staking);

  const stakeTx: FunctionInput = normalized.length === 1
    ? {
        contractName: extractContractName(StratoStaking),
        contractAddress: staking,
        method: "stake",
        args: {
          operator: normalized[0].operator,
          amount: normalized[0].amount,
        },
      }
    : {
        contractName: extractContractName(StratoStaking),
        contractAddress: staking,
        method: "stakeBatch",
        args: {
          stakeOperators: normalized.map(({ operator }) => operator),
          amounts: normalized.map(({ amount }) => amount),
        },
      };

  const txs: FunctionInput[] = [];
  if (allowance < totalAmount) {
    txs.push({
      contractName: extractContractName(Token),
      contractAddress: token,
      method: "approve",
      args: {
        spender: staking,
        value: MAX_UINT256.toString(),
      },
    });
  }
  txs.push(stakeTx);

  return await buildAndPost(accessToken, userAddress, txs);
};

export const moveStratoStake = async (
  accessToken: string,
  userAddress: string,
  fromOperator: string,
  toOperator: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "moveStake",
    args: {
      fromOperator: normalizeAddress(fromOperator),
      toOperator: normalizeAddress(toOperator),
      amount,
    },
  });
};

export const unstakeStrato = async (
  accessToken: string,
  userAddress: string,
  operator: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "unstake",
    args: {
      operator: normalizeAddress(operator),
      amount,
    },
  });
};

export const claimStratoRewards = async (
  accessToken: string,
  userAddress: string,
  operators?: string[],
  claimAll = false
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  let claimOperators = (operators || []).map(normalizeAddress).filter(Boolean);
  let maxBatchSize = claimOperators.length || 1;

  if (claimAll) {
    const info = await getStratoStakingInfo(accessToken, userAddress);
    maxBatchSize = batchSizeFromInfo(info);
    claimOperators = info.validators
      .filter((validator) => parseBigIntLike(validator.pendingRewards) > 0n)
      .map((validator) => validator.address);
  } else if (claimOperators.length) {
    maxBatchSize = await getMaxBatchSize(accessToken);
    assertWithinMaxBatchSize(claimOperators.length, maxBatchSize, "Claim operators");
  }

  if (!claimOperators.length) {
    throw new Error("No operators selected for reward claim");
  }

  const batches = chunkByMaxBatchSize(claimOperators, maxBatchSize);
  return await buildAndPost(accessToken, userAddress, batches.map((claimOperatorsBatch) => ({
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "claimRewards",
    args: {
      claimOperators: claimOperatorsBatch,
    },
  })));
};

export const claimStratoOperatorRewards = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "claimOperatorRewards",
    args: {},
  });
};

// USDST proposer fees have their own claim path, separate from STRATO rewards.
export const claimStratoFeeRewards = async (
  accessToken: string,
  userAddress: string,
  operators?: string[],
  claimAll = false
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  await requireValidatorSetUpgrade(accessToken);
  let claimOperators = (operators || []).map(normalizeAddress).filter(Boolean);
  let maxBatchSize = claimOperators.length || 1;

  if (claimAll) {
    const info = await getStratoStakingInfo(accessToken, userAddress);
    maxBatchSize = batchSizeFromInfo(info);
    claimOperators = info.validators
      .filter((validator) => parseBigIntLike(validator.pendingFees) > 0n)
      .map((validator) => validator.address);
  } else if (claimOperators.length) {
    maxBatchSize = await getMaxBatchSize(accessToken);
    assertWithinMaxBatchSize(claimOperators.length, maxBatchSize, "Claim operators");
  }

  if (!claimOperators.length) {
    throw new Error("No operators selected for fee claim");
  }

  const batches = chunkByMaxBatchSize(claimOperators, maxBatchSize);
  return await buildAndPost(accessToken, userAddress, batches.map((claimOperatorsBatch) => ({
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "claimFeeRewards",
    args: {
      claimOperators: claimOperatorsBatch,
    },
  })));
};

export const claimStratoOperatorFeeRewards = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(StratoStaking),
    contractAddress: requireStakingAddress(),
    method: "claimOperatorFeeRewards",
    args: {},
  });
};

// ---- validator lifecycle (operator / permissionless) ----

// List msg.sender as an operator; joining the consensus set is a separate tryActivate.
export const registerStratoOperator = async (
  accessToken: string,
  userAddress: string,
  input: OperatorProfileInput
): Promise<{ status: string; hash: string }> => {
  const validatorAddress = normalizeAddress(input.validatorAddress);
  if (!validatorAddress) throw badRequest("validatorAddress is required");
  if (input.commissionBps === undefined || input.commissionBps === "") throw badRequest("commissionBps is required");
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(ValidatorRegistry),
    contractAddress: requireValidatorRegistryAddress(),
    method: "register",
    args: {
      commissionBps: String(input.commissionBps),
      name: String(input.name || ""),
      description: String(input.description || ""),
      metadataURI: String(input.metadataURI || ""),
      protocolValidatorId: String(input.protocolValidatorId || ""),
      validatorAddress,
    },
  });
};

export const updateStratoOperatorProfile = async (
  accessToken: string,
  userAddress: string,
  input: OperatorProfileInput
): Promise<{ status: string; hash: string }> =>
  buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(ValidatorRegistry),
    contractAddress: requireValidatorRegistryAddress(),
    method: "updateProfile",
    args: {
      operator: normalizeAddress(userAddress),
      name: String(input.name || ""),
      description: String(input.description || ""),
      metadataURI: String(input.metadataURI || ""),
      protocolValidatorId: String(input.protocolValidatorId || ""),
    },
  });

const stakingCall = (method: string, args: Record<string, unknown> = {}): FunctionInput => ({
  contractName: extractContractName(StratoStaking),
  contractAddress: requireStakingAddress(),
  method,
  args,
});

// Put an eligible operator (default: the caller) into the consensus set.
export const activateStratoOperator = async (
  accessToken: string,
  userAddress: string,
  operator?: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("tryActivate", {
    operator: normalizeAddress(operator) || normalizeAddress(userAddress),
  }));
};

export const reconcileStratoValidatorSet = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("reconcileSet"));
};

export const syncStratoValidator = async (
  accessToken: string,
  userAddress: string,
  operator?: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("syncValidator", {
    operator: normalizeAddress(operator) || normalizeAddress(userAddress),
  }));
};

export const requestStratoExit = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("requestExit"));
};

export const cancelStratoExit = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("cancelExit"));
};

export const withdrawStratoUnbonded = async (
  accessToken: string,
  userAddress: string,
  requestIds?: string[],
  withdrawAll = false
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  let ids = (requestIds || []).map((id) => String(id)).filter(Boolean);
  let maxBatchSize = ids.length || 1;

  if (withdrawAll) {
    const info = await getStratoStakingInfo(accessToken, userAddress);
    maxBatchSize = batchSizeFromInfo(info);
    ids = info.unbondingRequests
      .filter((request) => request.ready && !request.claimed)
      .map((request) => request.id);
  } else if (ids.length) {
    maxBatchSize = await getMaxBatchSize(accessToken);
    assertWithinMaxBatchSize(ids.length, maxBatchSize, "Unbonding requests");
  }

  if (!ids.length) {
    throw new Error("No ready unbonding requests selected");
  }

  const batches = chunkByMaxBatchSize(ids, maxBatchSize);
  return await buildAndPost(accessToken, userAddress, batches.map((requestIdsBatch) => ({
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "withdrawUnbonded",
    args: {
      requestIds: requestIdsBatch,
    },
  })));
};

export const setStratoCommission = async (
  accessToken: string,
  userAddress: string,
  commissionBps: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "setCommissionBps",
    args: {
      newCommissionBps: commissionBps,
    },
  });
};

export const setStratoOperatorCommission = async (
  accessToken: string,
  userAddress: string,
  operator: string,
  commissionBps: string
): Promise<{ status: string; hash: string }> =>
  castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setOperatorCommissionBps", [
    normalizeAddress(operator),
    commissionBps,
  ]);

export const selfBondStrato = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  const token = requireStratoTokenAddress();

  return await buildAndPost(accessToken, userAddress, [
    {
      contractName: extractContractName(Token),
      contractAddress: token,
      method: "approve",
      args: {
        spender: staking,
        value: amount,
      },
    },
    {
      contractName: extractContractName(StratoStaking),
      contractAddress: staking,
      method: "selfBond",
      args: { amount },
    },
  ]);
};

export const unbondSelfStrato = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();

  return await buildAndPost(accessToken, userAddress, {
    contractName: extractContractName(StratoStaking),
    contractAddress: staking,
    method: "unbondSelf",
    args: { amount },
  });
};

export const depositStratoRewards = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  const token = requireStratoTokenAddress();

  return await buildAndPost(accessToken, userAddress, [
    {
      contractName: extractContractName(Token),
      contractAddress: token,
      method: "approve",
      args: {
        spender: staking,
        value: amount,
      },
    },
    {
      contractName: extractContractName(StratoStaking),
      contractAddress: staking,
      method: "depositRewards",
      args: { amount },
    },
  ]);
};

export const addStratoOperator = async (
  accessToken: string,
  userAddress: string,
  input: AddStratoOperatorInput | AddStratoOperatorInput[]
): Promise<{ status: string; hash: string }> => {
  const operators = (Array.isArray(input) ? input : [input]).map((item) => ({
    operator: normalizeAddress(item.operator),
    commissionBps: String(item.commissionBps),
    name: String(item.name || ""),
    description: String(item.description || ""),
    metadataURI: String(item.metadataURI || ""),
    protocolValidatorId: String(item.protocolValidatorId || ""),
    validatorAddress: normalizeAddress(item.validatorAddress),
  }));

  if (!operators.length || operators.some((item) => !item.operator || item.commissionBps === "")) {
    throw new Error("At least one operator is required");
  }

  const registry = requireValidatorRegistryAddress();
  // addOperator/addOperators only take a validator address once the upgrade is deployed;
  // passing it to the older registry would be an arity mismatch, not an ignored extra.
  const contractState = await getContractState(accessToken);
  const takesValidatorAddress = contractState?.validatorSetDeployed !== false;

  if (operators.length === 1) {
    const operator = operators[0];
    return castVoteOnIssue(accessToken, userAddress, registry, "addOperator", [
      operator.operator,
      operator.commissionBps,
      operator.name,
      operator.description,
      operator.metadataURI,
      operator.protocolValidatorId,
      ...(takesValidatorAddress ? [operator.validatorAddress] : []),
    ]);
  }

  return castVoteOnIssue(accessToken, userAddress, registry, "addOperators", [
    operators.map(({ operator }) => operator),
    operators.map(({ commissionBps }) => commissionBps),
    operators.map(({ name }) => name),
    operators.map(({ description }) => description),
    operators.map(({ metadataURI }) => metadataURI),
    operators.map(({ protocolValidatorId }) => protocolValidatorId),
    ...(takesValidatorAddress ? [operators.map(({ validatorAddress }) => validatorAddress)] : []),
  ]);
};

export const setStratoValidatorAddress = async (
  accessToken: string,
  userAddress: string,
  operator: string,
  validatorAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireValidatorRegistryAddress(), "setValidatorAddress", [
    normalizeAddress(operator),
    normalizeAddress(validatorAddress),
  ]);
};

export const setStratoEmergencyKicker = async (
  accessToken: string,
  userAddress: string,
  kicker: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireValidatorRegistryAddress(), "setEmergencyKicker", [
    normalizeAddress(kicker),
  ]);
};

export const removeStratoOperator = async (
  accessToken: string,
  userAddress: string,
  operator: string
): Promise<{ status: string; hash: string }> =>
  castVoteOnIssue(accessToken, userAddress, requireValidatorRegistryAddress(), "removeOperator", [
    normalizeAddress(operator),
  ]);

export const startStratoRewardSchedule = async (
  accessToken: string,
  userAddress: string,
  rewardAmount: string,
  startTime: string,
  duration: string,
  baseRewardBps: string,
  name: string,
  description: string
): Promise<{ status: string; hash: string }> =>
  castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "startRewardSchedule", [
    rewardAmount,
    startTime,
    duration,
    baseRewardBps,
    name,
    description,
  ]);

export const stopStratoRewardSchedule = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> =>
  castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "stopRewardSchedule", []);

export const setStratoStakingParams = async (
  accessToken: string,
  userAddress: string,
  args: {
    unbondingSeconds: string;
    baseRewardBps: string;
    maxCommissionBps: string;
    maxBatchSize: string;
  }
): Promise<{ status: string; hash: string }> =>
  castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setParams", [
    args.unbondingSeconds,
    args.baseRewardBps,
    args.maxCommissionBps,
    args.maxBatchSize,
  ]);

export const setStratoValidatorParams = async (
  accessToken: string,
  userAddress: string,
  args: {
    minStake: string;
    minSelfBond: string;
    proposerFeeBps: string;
    maxConsecutiveMisses: string;
    jailCooldown: string;
  }
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setValidatorParams", [
    args.minStake,
    args.minSelfBond,
    args.proposerFeeBps,
    args.maxConsecutiveMisses,
    args.jailCooldown,
  ]);
};

export const setStratoSetParams = async (
  accessToken: string,
  userAddress: string,
  args: {
    maxActiveValidators: string;
    hardCapActiveValidators: string;
    evictionMarginBps: string;
    maxSetMutationsPerBlock: string;
    exitNoticeSeconds: string;
    unkickCooldown: string;
    maxOperatorStakeBps: string;
    joinsPaused: boolean;
  }
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setSetParams", [
    args.maxActiveValidators,
    args.hardCapActiveValidators,
    args.evictionMarginBps,
    args.maxSetMutationsPerBlock,
    args.exitNoticeSeconds,
    args.unkickCooldown,
    args.maxOperatorStakeBps,
    args.joinsPaused,
  ]);
};

export const setStratoGovernance = async (
  accessToken: string,
  userAddress: string,
  governance: string,
  syncEnabled: boolean
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setGovernance", [
    normalizeAddress(governance) || normalizeAddress(constants.mercataGovernance),
    syncEnabled,
  ]);
};

export const recoverStratoUnattributedFees = async (
  accessToken: string,
  userAddress: string,
  to: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "recoverUnattributedFees", [
    normalizeAddress(to),
    amount,
  ]);
};

// MercataGovernance (0x100): wire the staking contract and bound the validator set.
// Governance grew its staking hooks in the same rollout, so it is gated on the same flag.
export const setGovernanceStakingContract = async (
  accessToken: string,
  userAddress: string,
  stakingContract?: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, normalizeAddress(constants.mercataGovernance), "setStakingContract", [
    normalizeAddress(stakingContract) || requireStakingAddress(),
  ]);
};

export const setGovernanceHardCap = async (
  accessToken: string,
  userAddress: string,
  hardCap: string
): Promise<{ status: string; hash: string }> => {
  await requireValidatorSetUpgrade(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, normalizeAddress(constants.mercataGovernance), "setHardCapValidators", [
    hardCap,
  ]);
};
