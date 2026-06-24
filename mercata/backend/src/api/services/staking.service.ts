import { cirrus, strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { castVoteOnIssue } from "./user.service";

const { Token, StratoStaking, ValidatorRegistry } = constants;
const WAD = 10n ** 18n;
const BPS_DIVISOR = 10000n;
const YEAR_SECONDS = 365n * 24n * 60n * 60n;
const MAX_UINT256 = (1n << 256n) - 1n;

export interface StratoOperatorInfo {
  address: string;
  active: boolean;
  registryActive: boolean;
  operator: string;
  name: string;
  description: string;
  metadataURI: string;
  protocolValidatorId: string;
  commissionBps: string;
  selfBond: string;
  delegatedStake: string;
  totalStake: string;
  estimatedApy: string;
  userStake: string;
  pendingRewards: string;
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
  stakingAddress: string;
  validatorRegistryAddress: string;
  stratoTokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: string;
  walletBalance: string;
  totalUserStake: string;
  totalSelfBond: string;
  totalUnbonding: string;
  totalRewardableStake: string;
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
  userTotalStake: string;
  claimableRewards: string;
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
  stakingAddress: stakingAddress(),
  validatorRegistryAddress: validatorRegistryAddress(),
  stratoTokenAddress: stratoTokenAddress(),
  tokenName: "STRATO",
  tokenSymbol: "STRATO",
  tokenDecimals: "18",
  walletBalance: "0",
  totalUserStake: "0",
  totalSelfBond: "0",
  totalUnbonding: "0",
  totalRewardableStake: "0",
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
  userTotalStake: "0",
  claimableRewards: "0",
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

const getContractState = async (accessToken: string): Promise<Record<string, any> | null> => {
  const address = stakingAddress();
  if (!address) return null;

  try {
    const { data } = await cirrus.get(accessToken, `/${StratoStaking}`, {
      params: {
        address: `eq.${address}`,
        select: [
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
        ].join(","),
      },
    });

    return data?.[0] || null;
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

const projectedStakeIndex = (state: Record<string, any>): bigint => {
  const stored = parseBigIntLike(state.globalStakeRewardPerTokenStored);
  const periodStart = Number(state.periodStart || 0);
  const periodFinish = Number(state.periodFinish || 0);
  const lastUpdateTime = Number(state.lastUpdateTime || 0);
  const now = Math.floor(Date.now() / 1000);
  const current = Math.min(now, periodFinish);

  if (!current || now < periodStart || current <= lastUpdateTime) return stored;

  let reserve = parseBigIntLike(state.scheduledRewardRemaining);
  const activeOperatorCount = parseBigIntLike(state.activeOperatorCount);
  const totalRewardableStake = parseBigIntLike(state.totalRewardableStake);
  const delta = BigInt(current - lastUpdateTime);

  if (parseBigIntLike(state.baseRewardRate) > 0n && activeOperatorCount > 0n && reserve > 0n) {
    let baseAccrued = parseBigIntLike(state.baseRewardRate) * delta;
    if (baseAccrued > reserve) baseAccrued = reserve;

    const perOperator = baseAccrued / activeOperatorCount;
    reserve -= perOperator * activeOperatorCount;
  }

  if (parseBigIntLike(state.stakeRewardRate) <= 0n || totalRewardableStake <= 0n || reserve <= 0n) {
    return stored;
  }

  let stakeAccrued = parseBigIntLike(state.stakeRewardRate) * delta;
  if (stakeAccrued > reserve) stakeAccrued = reserve;

  return stored + ((stakeAccrued * WAD) / totalRewardableStake);
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
  commissionBps: bigint
): bigint => {
  const totalRewardableStake = parseBigIntLike(state.totalRewardableStake);
  if (totalRewardableStake <= 0n) return 0n;

  const now = Math.floor(Date.now() / 1000);
  const periodFinish = Number(state.periodFinish || 0);
  if (!periodFinish || now >= periodFinish) return 0n;

  const grossBps = (parseBigIntLike(state.stakeRewardRate) * YEAR_SECONDS * BPS_DIVISOR) / totalRewardableStake;
  const netCommissionBps = commissionBps >= BPS_DIVISOR ? BPS_DIVISOR : commissionBps;
  return (grossBps * (BPS_DIVISOR - netCommissionBps)) / BPS_DIVISOR;
};

export const getStratoStakingInfo = async (
  accessToken: string,
  userAddress?: string
): Promise<StratoStakingInfo> => {
  const state = await getContractState(accessToken);
  if (!state) return emptyInfo();

  const tokenAddress = normalizeAddress(state.stratoToken) || stratoTokenAddress();
  const currentStakeIndex = projectedStakeIndex(state);

  const [
    tokenInfo,
    walletBalance,
    operatorRows,
    userDelegatedStake,
    userPendingRewards,
    userRewardPaid,
    unbondingRequests,
    validatorProfiles,
  ] = await Promise.all([
    getTokenInfo(accessToken, tokenAddress),
    getTokenBalance(accessToken, tokenAddress, userAddress),
    getOperatorRows(accessToken),
    getUserMap(accessToken, "delegatedStake", userAddress),
    getUserMap(accessToken, "pendingDelegatorRewards", userAddress),
    getUserMap(accessToken, "userRewardPerStakePaid", userAddress),
    getUnbondingRequests(accessToken, userAddress),
    getValidatorProfiles(accessToken),
  ]);

  let userTotalStake = 0n;
  let claimableRewards = 0n;
  let userWeightedApyBps = 0n;
  let activeApyBpsTotal = 0n;
  let activeApyCount = 0n;

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
    const projectedIndex = projectedDelegatorIndex(value, currentStakeIndex);
    const projectedReward = userStake > 0n && projectedIndex > paid
      ? (userStake * (projectedIndex - paid)) / WAD
      : 0n;
    const pendingRewards = pendingStored + projectedReward;
    const apyBps = validatorApyBps(state, commissionBps);

    if (parseBoolLike(value.active)) {
      activeApyBpsTotal += apyBps;
      activeApyCount += 1n;
    }

    userTotalStake += userStake;
    claimableRewards += pendingRewards;
    userWeightedApyBps += userStake * apyBps;

    return {
      address: operatorAddress,
      active: parseBoolLike(value.active),
      registryActive: parseBoolLike(profile.active),
      operator: operatorAddress,
      name: String(profile.name || ""),
      description: String(profile.description || ""),
      metadataURI: String(profile.metadataURI || ""),
      protocolValidatorId: String(profile.protocolValidatorId || ""),
      commissionBps: commissionBps.toString(),
      selfBond: selfBond.toString(),
      delegatedStake: delegatedStake.toString(),
      totalStake: totalStake.toString(),
      estimatedApy: formatBpsAsPercent(apyBps),
      userStake: userStake.toString(),
      pendingRewards: pendingRewards.toString(),
    };
  });

  const estimatedApy = userTotalStake > 0n
    ? formatBpsAsPercent(userWeightedApyBps / userTotalStake)
    : activeApyCount > 0n
      ? formatBpsAsPercent(activeApyBpsTotal / activeApyCount)
      : "-";

  return {
    configured: true,
    deployed: true,
    stakingAddress: stakingAddress(),
    validatorRegistryAddress: validatorRegistryAddress(),
    stratoTokenAddress: tokenAddress,
    ...tokenInfo,
    walletBalance,
    totalUserStake: String(state.totalUserStake || "0"),
    totalSelfBond: String(state.totalSelfBond || "0"),
    totalUnbonding: String(state.totalUnbonding || "0"),
    totalRewardableStake: String(state.totalRewardableStake || "0"),
    activeValidatorCount: String(state.activeOperatorCount || "0"),
    rewardReserve: String(state.rewardReserve || "0"),
    rewardPeriodAmount: String(state.rewardPeriodAmount || "0"),
    scheduledRewardRemaining: String(state.scheduledRewardRemaining || "0"),
    baseRewardBps: String(state.baseRewardBps || "0"),
    maxCommissionBps: String(state.maxCommissionBps || "0"),
    maxBatchSize: String(state.maxBatchSize || "0"),
    unbondingSeconds: String(state.unbondingSeconds || "0"),
    periodStart: String(state.periodStart || "0"),
    periodFinish: String(state.periodFinish || "0"),
    rewardPeriodName: String(state.rewardPeriodName || ""),
    rewardPeriodDescription: String(state.rewardPeriodDescription || ""),
    baseRewardRate: String(state.baseRewardRate || "0"),
    stakeRewardRate: String(state.stakeRewardRate || "0"),
    estimatedApy,
    userTotalStake: userTotalStake.toString(),
    claimableRewards: claimableRewards.toString(),
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
  const state = await getContractState(accessToken);
  return batchSizeFromValue(state?.maxBatchSize);
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
  }));

  if (!operators.length || operators.some((item) => !item.operator || item.commissionBps === "")) {
    throw new Error("At least one operator is required");
  }

  const registry = requireValidatorRegistryAddress();
  if (operators.length === 1) {
    const operator = operators[0];
    return castVoteOnIssue(accessToken, userAddress, registry, "addOperator", [
      operator.operator,
      operator.commissionBps,
      operator.name,
      operator.description,
      operator.metadataURI,
      operator.protocolValidatorId,
    ]);
  }

  return castVoteOnIssue(accessToken, userAddress, registry, "addOperators", [
    operators.map(({ operator }) => operator),
    operators.map(({ commissionBps }) => commissionBps),
    operators.map(({ name }) => name),
    operators.map(({ description }) => description),
    operators.map(({ metadataURI }) => metadataURI),
    operators.map(({ protocolValidatorId }) => protocolValidatorId),
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
