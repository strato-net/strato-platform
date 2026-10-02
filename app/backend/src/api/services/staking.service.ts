import { bloc, cirrus, strato } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { keccak256 } from "../../utils/keccak256";
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

// Two staking layouts are live at once:
//   v1 - operator-keyed StratoStaking/ValidatorRegistry paying a funded reward schedule
//        (mainnet). Scalars from bloc state, per-user and per-operator mappings from Cirrus.
//   v2 - validator-keyed contracts paid only by block rewards and proposer fees (helium,
//        upgraded in place). Read from bloc state; see getStakingBlocState.
export type StakingContractVersion = "v1" | "v2";

// 0 = Missing, 1 = Registered (listed, not in the consensus set), 2 = Active (in the set), 3 = Kicked
export type StratoOperatorStatus = 0 | 1 | 2 | 3;

export interface StratoOperatorInfo {
  // v2: the validator (consensus node) address, which keys every staking record.
  // v1: the operator address.
  address: string;
  active: boolean;
  registryActive: boolean;
  // The account that manages the record: self-bonds, sets commission, collects the
  // operator's share. v1: same as address.
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
  // What the operator can claim from this record: STRATO and USDST.
  operatorPendingRewards: string;
  operatorPendingFees: string;
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
  contractVersion: StakingContractVersion;
  // Kept for clients that predate contractVersion: true exactly when contractVersion is
  // "v2", i.e. the validator-set / proposer-fee calls exist on chain.
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
  // v1 reward schedule; "0"/"" on v2, which has none.
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
  // v2: until this time minStake is met by self-bond + delegated stake, afterwards by
  // self-bond alone. "0" = never set (the combined rule applies).
  selfBondGraceUntil: string;
  selfBondRuleActive: boolean;
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
  totalRewardsCredited: string;
  userTotalStake: string;
  userTotalStakeUsd: string;
  claimableRewards: string;
  claimableFees: string;
  totalEarned: string;
  isOperator: boolean;
  // Records the requesting user operates (v1: [user] when the user is an operator).
  operatedValidators: string[];
  // Single-operator fields describe the first entry of operatedValidators; on v2
  // operatorAddress is that record's key (the validator address).
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
  validator: string;
  amount: string;
};

export type AddStratoOperatorInput = {
  // v2 only, where it is required; v1 lists operators alone.
  validator?: string;
  operator: string;
  commissionBps: string;
  name?: string;
  description?: string;
  metadataURI?: string;
  protocolValidatorId?: string;
};

export type RegisterValidatorInput = {
  validator: string;
  commissionBps: string;
  name?: string;
  description?: string;
  metadataURI?: string;
  // r || s || v from the validator key over the authorization digest.
  signature?: string;
};

export type ValidatorProfileInput = {
  // v2 only, where it is required; v1 profiles are keyed by the caller.
  validator?: string;
  name?: string;
  description?: string;
  metadataURI?: string;
  protocolValidatorId?: string;
};

export type StratoAuthorizationDigest = {
  registry: string;
  validator: string;
  operator: string;
  nonce: string;
  digest: string;
};

const normalizeAddress = (value: unknown): string =>
  String(value || "").toLowerCase().replace(/^0x/, "");

const isNormalizedAddress = (value: string): boolean => /^[0-9a-f]{40}$/.test(value);

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

const uintString = (value: unknown): string => parseBigIntLike(value).toString();

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
  contractVersion: "v1",
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
  selfBondGraceUntil: "0",
  selfBondRuleActive: false,
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
  totalRewardsCredited: "0",
  userTotalStake: "0",
  userTotalStakeUsd: "0",
  claimableRewards: "0",
  claimableFees: "0",
  totalEarned: "0",
  isOperator: false,
  operatedValidators: [],
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

// ---- bloc state and version detection ----

// Bloc returns a contract's whole state: every scalar and mapping (nested objects keyed by
// lowercase hex address), plus each function's signature under its name. `?name=`
// narrowing fails on this API, so the full snapshot is fetched and shared briefly; /info
// is hot and the snapshot is one round trip however many users ask. Fields never written
// (and zero struct members) are omitted, which parseBigIntLike/parseBoolLike read as
// 0/false. Failures are never cached.
const BLOC_STATE_TTL_MS = 10 * 1000;
const blocStateCache = new Map<string, { expiresAt: number; state: Promise<Record<string, any>> }>();

const getBlocState = (
  accessToken: string,
  contractName: string,
  address: string,
  fresh = false
): Promise<Record<string, any>> => {
  const cacheKey = `${contractName}:${address}`;
  const cached = blocStateCache.get(cacheKey);
  if (!fresh && cached && Date.now() < cached.expiresAt) return cached.state;

  const state = bloc.get(accessToken, `/contracts/${contractName}/${address}/state`)
    .then(({ data }: { data: unknown }) => {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`Unexpected ${contractName} state response`);
      }
      return data as Record<string, any>;
    });

  const entry = { expiresAt: Date.now() + BLOC_STATE_TTL_MS, state };
  blocStateCache.set(cacheKey, entry);
  state.catch(() => {
    if (blocStateCache.get(cacheKey) === entry) blocStateCache.delete(cacheKey);
  });
  return state;
};

const getStakingBlocState = (accessToken: string, fresh = false): Promise<Record<string, any>> =>
  getBlocState(accessToken, extractContractName(StratoStaking), requireStakingAddress(), fresh);

const isFunctionEntry = (value: unknown): boolean =>
  typeof value === "string" && value.startsWith("function");

// v2 is recognised by the creditBlockReward function in bloc state; v1 has no such call.
// Cirrus cannot answer this: the BlockApps-StratoStaking view describes whichever code
// collection named StratoStaking was uploaded last, not the logic the proxy runs (see
// getContractState). The verdict is cached briefly so an upgrade is picked up without a
// restart; while bloc is unreachable the last verdict stands, and null means none was
// ever reached.
const VERSION_TTL_MS = 60 * 1000;
let versionVerdict: { address: string; version: StakingContractVersion; expiresAt: number } | null = null;

const detectContractVersion = async (accessToken: string): Promise<StakingContractVersion | null> => {
  const address = stakingAddress();
  if (!address) return null;
  if (versionVerdict?.address === address && Date.now() < versionVerdict.expiresAt) {
    return versionVerdict.version;
  }

  try {
    const state = await getStakingBlocState(accessToken);
    const version: StakingContractVersion = isFunctionEntry(state.creditBlockReward) ? "v2" : "v1";
    versionVerdict = { address, version, expiresAt: Date.now() + VERSION_TTL_MS };
    return version;
  } catch {
    return versionVerdict?.address === address ? versionVerdict.version : null;
  }
};

// Transactions are built against a specific ABI, so unlike reads they never guess.
const requireContractVersion = async (accessToken: string): Promise<StakingContractVersion> => {
  requireStakingAddress();
  const version = await detectContractVersion(accessToken);
  if (!version) {
    const error = new Error("Unable to read the staking contract right now; please try again shortly.");
    (error as any).statusCode = 503;
    throw error;
  }
  return version;
};

const requireV2 = async (accessToken: string): Promise<void> => {
  if ((await requireContractVersion(accessToken)) !== "v2") {
    throw badRequest(
      "Validator set management is unavailable: the validator-keyed staking contracts have not been deployed on this network yet."
    );
  }
};

const requireV1 = async (accessToken: string, feature: string): Promise<void> => {
  if ((await requireContractVersion(accessToken)) === "v2") {
    throw badRequest(`${feature} is not supported by this network's staking contract: validators are paid by block rewards, not a funded schedule.`);
  }
};

// ---- contract state ----

type StakingContractState = {
  version: StakingContractVersion;
  state: Record<string, any>;
};

// Scalars for both layouts come from the bloc snapshot version detection has just
// fetched (shared for BLOC_STATE_TTL_MS), so this costs no extra round trip. The
// Cirrus base view is not a safe source for them: slipstream rebuilds
// BlockApps-StratoStaking from whichever code collection was uploaded last, and any
// deploy of BaseCodeCollection.sol redeclares it with the v2 layout while a v1 proxy
// still holds v1 state, dropping every v1-only column (upquark, 2026-09-25). Mapping
// views keep serving v1 reads because both layouts still declare those collections.
// The version falls back to v1 when none was ever detected, which is what every
// network showed before v2 existed; a null here means bloc is unreachable.
const getContractState = async (accessToken: string): Promise<StakingContractState | null> => {
  if (!stakingAddress()) return null;

  const version = (await detectContractVersion(accessToken)) ?? "v1";
  try {
    return { version, state: await getStakingBlocState(accessToken) };
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

// Registry profiles, keyed by operator on v1 and by validator on v2. Only display fields
// are read here (their meaning did not change), so Cirrus serves both layouts.
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
      const key = normalizeAddress(row.key);
      if (key) profiles.set(key, row.value || {});
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

// ---- v2 snapshot helpers ----

// A bloc mapping (object keyed by address) as a Map with normalized keys.
const addressKeyed = (mapping: unknown): Map<string, any> => {
  const values = new Map<string, any>();
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return values;

  for (const [key, value] of Object.entries(mapping as Record<string, any>)) {
    const address = normalizeAddress(key);
    if (address) values.set(address, value);
  }
  return values;
};

// The user's row of a user => validator => value mapping.
const userRow = (mapping: unknown, user: string): Map<string, any> =>
  user && mapping && typeof mapping === "object" ? addressKeyed((mapping as Record<string, any>)[user]) : new Map();

// Records written before the upgrade carry no operator field: their key is their
// operator (StratoStaking.operatorOf / ValidatorRegistry.operatorOf do the same).
const recordOperator = (validator: string, record: Record<string, any>): string => {
  const operator = normalizeAddress(record?.operator);
  return isNormalizedAddress(operator) && !/^0+$/.test(operator) ? operator : validator;
};

const isSelfBondRuleActive = (state: Record<string, any>, now: bigint): boolean => {
  const graceUntil = parseBigIntLike(state.selfBondGraceUntil);
  return graceUntil > 0n && now >= graceUntil;
};

type V2ValidatorRecord = {
  validator: string;
  operator: string;
  value: Record<string, any>;
  active: boolean;
  isValidator: boolean;
  commissionBps: bigint;
  selfBond: bigint;
  delegatedStake: bigint;
  totalStake: bigint;
  jailedUntil: bigint;
  exitReadyTime: bigint;
  status: StratoOperatorStatus;
  eligible: boolean;
};

// Every listed record with the lifecycle facts StratoStaking derives (status, eligible),
// ordered by validator address like the v1 Cirrus read.
const v2ValidatorRecords = (state: Record<string, any>): V2ValidatorRecord[] => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const minStake = parseBigIntLike(state.minStake);
  const selfBondRuleActive = isSelfBondRuleActive(state, now);
  const isValidatorMap = addressKeyed(state.isValidator);
  const jailedUntilMap = addressKeyed(state.jailedUntil);
  const exitReadyMap = addressKeyed(state.exitReadyTime);

  return [...addressKeyed(state.operators).entries()]
    .filter(([, value]) => value && typeof value === "object" && parseBoolLike(value.exists))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([validator, value]) => {
      const active = parseBoolLike(value.active);
      const isValidator = parseBoolLike(isValidatorMap.get(validator));
      const selfBond = parseBigIntLike(value.selfBond);
      const delegatedStake = parseBigIntLike(value.delegatedStake);
      const totalStake = selfBond + delegatedStake;
      const jailedUntil = parseBigIntLike(jailedUntilMap.get(validator));
      const exitReadyTime = parseBigIntLike(exitReadyMap.get(validator));
      // _meetsMinStake: combined stake until the self-bond grace ends, self-bond after.
      const meetsMinStake = selfBondRuleActive ? selfBond >= minStake : totalStake >= minStake;

      return {
        validator,
        operator: recordOperator(validator, value),
        value,
        active,
        isValidator,
        commissionBps: parseBigIntLike(value.commissionBps),
        selfBond,
        delegatedStake,
        totalStake,
        jailedUntil,
        exitReadyTime,
        status: !active ? 3 : isValidator ? 2 : 1,
        eligible: active && meetsMinStake && now >= jailedUntil && (exitReadyTime === 0n || now < exitReadyTime),
      };
    });
};

const v2UnbondingRequests = (state: Record<string, any>, user: string): StratoUnbondingRequestInfo[] => {
  const queue = user ? state.unbondingQueue?.[user] : undefined;
  if (!queue || typeof queue !== "object") return [];

  const now = Math.floor(Date.now() / 1000);
  return Object.entries(queue as Record<string, any>)
    .map(([id, raw]) => {
      const value = raw || {};
      const releaseTime = uintString(value.releaseTime);
      const claimed = parseBoolLike(value.claimed);
      return {
        id: String(id),
        amount: uintString(value.amount),
        releaseTime,
        claimed,
        ready: !claimed && Number(releaseTime) <= now,
      };
    })
    .sort((a, b) => Number(parseBigIntLike(a.id) - parseBigIntLike(b.id)));
};

// ---- v2 realized block-reward APY ----

const REWARD_WINDOW_DAYS = 7n;
const REWARD_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const RECENT_REWARDS_TTL_MS = 60 * 1000;
let recentRewardsCache: { address: string; expiresAt: number; totals: Promise<Map<string, bigint>> } | null = null;

// Cirrus keeps block_timestamp as text in this form ("2026-09-14 19:47:31 UTC"), so a gte
// on the same form compares chronologically.
const cirrusTimestamp = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");

// STRATO block rewards credited per validator over the trailing window. Summed in Postgres
// (otherwise one row per block), with ::text keeping 18-decimal totals exact through JSON.
const getRecentBlockRewards = (accessToken: string): Promise<Map<string, bigint>> => {
  const address = stakingAddress();
  if (!address) return Promise.resolve(new Map());
  if (recentRewardsCache?.address === address && Date.now() < recentRewardsCache.expiresAt) {
    return recentRewardsCache.totals;
  }

  const since = Math.floor(Date.now() / 1000) - REWARD_WINDOW_SECONDS;
  const totals = cirrus.get(accessToken, `/${constants.Event}`, {
    params: {
      address: `eq.${address}`,
      event_name: "eq.BlockRewardCredited",
      block_timestamp: `gte.${cirrusTimestamp(since)}`,
      select: "validator:attributes->>validator,amount:attributes->>amount::numeric.sum()::text",
    },
  })
    .then(({ data }: { data: any[] }) => {
      const byValidator = new Map<string, bigint>();
      for (const row of data || []) {
        const validator = normalizeAddress(row.validator);
        if (validator) byValidator.set(validator, (byValidator.get(validator) || 0n) + parseBigIntLike(row.amount));
      }
      return byValidator;
    })
    .catch(() => {
      if (recentRewardsCache === entry) recentRewardsCache = null;
      return new Map<string, bigint>();
    });

  const entry = { address, expiresAt: Date.now() + RECENT_REWARDS_TTL_MS, totals };
  recentRewardsCache = entry;
  return totals;
};

// What the trailing window's block rewards paid per unit of stake, net of commission,
// annualised, in bps. Delegators receive amount * delegated/weight * (1 - commission),
// i.e. amount * (1 - commission) / weight per unit.
const realizedApyBps = (credited: bigint, stake: bigint, commissionBps: bigint): bigint => {
  if (credited <= 0n || stake <= 0n) return 0n;
  const netBps = BPS_DIVISOR - (commissionBps >= BPS_DIVISOR ? BPS_DIVISOR : commissionBps);
  return (credited * 365n * netBps) / (REWARD_WINDOW_DAYS * stake);
};

// Commission as StratoStaking charges it: capped at maxCommissionBps.
const effectiveCommissionBps = (state: Record<string, any>, commissionBps: bigint): bigint => {
  const cap = parseBigIntLike(state.maxCommissionBps);
  return commissionBps < cap ? commissionBps : cap;
};

const networkApyBps = (state: Record<string, any>, credited: Map<string, bigint>): bigint => {
  let total = 0n;
  for (const amount of credited.values()) total += amount;
  return realizedApyBps(total, parseBigIntLike(state.totalRewardableStake), 0n);
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

  // v2: self-bond belongs to the operator of each validator record, not to its key.
  if ((await detectContractVersion(accessToken)) === "v2") {
    const state = await getStakingBlocState(accessToken).catch(() => null);
    if (state) {
      let amount = 0n;
      for (const stake of userRow(state.delegatedStake, user).values()) amount += parseBigIntLike(stake);
      for (const record of v2ValidatorRecords(state)) {
        if (record.operator === user) amount += record.selfBond;
      }
      for (const request of v2UnbondingRequests(state, user)) {
        if (!request.claimed) amount += parseBigIntLike(request.amount);
      }
      return { tokenAddress, amount };
    }
  }

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
// Both layouts name the claimant `user` / `operator` in these events.
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

// ---- v1 reward schedule projection ----

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

// Network staking APY for the Earn page. v1: best available net schedule APY across
// active operators. v2: realized trailing-week block rewards over the rewardable stake.
// Consumed by the earn service so the portfolio STRATO row can show combined native +
// rewards APY.
export const getStratoStakingNetworkApy = async (accessToken: string): Promise<string | null> => {
  const contractState = await getContractState(accessToken);
  if (!contractState) return null;

  const { state, version } = contractState;
  if (version === "v2") {
    const apyBps = networkApyBps(state, await getRecentBlockRewards(accessToken));
    return apyBps > 0n ? formatBpsAsPercent(apyBps) : null;
  }

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

  return contractState.version === "v2"
    ? getV2StakingInfo(accessToken, contractState.state, userAddress)
    : getV1StakingInfo(accessToken, contractState.state, userAddress);
};

// v1: operator-keyed records, rewards projected from the funded schedule. The contract
// has no validator-set, liveness or proposer-fee state, so those read as unset.
const getV1StakingInfo = async (
  accessToken: string,
  state: Record<string, any>,
  userAddress?: string
): Promise<StratoStakingInfo> => {
  const tokenAddress = normalizeAddress(state.stratoToken) || stratoTokenAddress();
  const currentIndexes = projectedRewardIndexes(state);

  const [
    tokenInfo,
    walletBalance,
    operatorRows,
    userDelegatedStake,
    userPendingRewards,
    userRewardPaid,
    unbondingRequests,
    validatorProfiles,
    lifetimeClaimedRewards,
    stratoPriceWad,
  ] = await Promise.all([
    getTokenInfo(accessToken, tokenAddress),
    getTokenBalance(accessToken, tokenAddress, userAddress),
    getOperatorRows(accessToken),
    getUserMap(accessToken, "delegatedStake", userAddress),
    getUserMap(accessToken, "pendingDelegatorRewards", userAddress),
    getUserMap(accessToken, "userRewardPerStakePaid", userAddress),
    getUnbondingRequests(accessToken, userAddress),
    getValidatorProfiles(accessToken),
    getLifetimeClaimedRewards(accessToken, userAddress),
    getStratoTokenPriceWad(accessToken),
  ] as const);

  let userTotalStake = 0n;
  let claimableRewards = 0n;
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

  const validators = operatorRows.map((row): StratoOperatorInfo => {
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
    const apyBps = validatorApyBps(state, commissionBps, currentIndexes.stakeRewardRate);
    const operatorRewards = projectedOperatorRewards(value, currentIndexes);
    const recordFees = parseBigIntLike(value.pendingSelfBondFees) + parseBigIntLike(value.pendingFeeCommission);

    // No consensus-set bookkeeping on v1: an operator's `active` flag *is* its set
    // membership, so deriving the status from it keeps the badges honest.
    const active = parseBoolLike(value.active);
    const status: StratoOperatorStatus = active ? 2 : 3;

    if (operatorAddress && operatorAddress === normalizedUserAddress) {
      isOperator = true;
      connectedOperatorAddress = operatorAddress;
      operatorStatus = status;
      operatorPendingBaseRewards = operatorRewards.base;
      operatorPendingCommission = operatorRewards.commission;
      operatorPendingSelfBondRewards = operatorRewards.selfBond;
      operatorPendingFees = recordFees;
      currentOperatorCommissionBps = commissionBps;
    }

    if (active && apyBps > bestActiveApyBps) {
      bestActiveApyBps = apyBps;
    }

    userTotalStake += userStake;
    claimableRewards += pendingRewards;
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
      validatorAddress: normalizeAddress(profile.validatorAddress),
      status,
      isValidator: active,
      eligible: active,
      isWaiter: false,
      jailedUntil: "0",
      exitReadyTime: "0",
      blocksProposed: "0",
      missedProposals: "0",
      consecutiveMisses: "0",
      commissionBps: commissionBps.toString(),
      selfBond: selfBond.toString(),
      delegatedStake: delegatedStake.toString(),
      totalStake: totalStake.toString(),
      estimatedApy: formatBpsAsPercent(apyBps),
      userStake: userStake.toString(),
      pendingRewards: pendingRewards.toString(),
      pendingFees: "0",
      operatorPendingRewards: (operatorRewards.base + operatorRewards.selfBond + operatorRewards.commission).toString(),
      operatorPendingFees: recordFees.toString(),
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
    contractVersion: "v1",
    validatorSetDeployed: false,
    stakingAddress: stakingAddress(),
    validatorRegistryAddress: validatorRegistryAddress(),
    stratoTokenAddress: tokenAddress,
    usdstTokenAddress: "",
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
    minStake: "0",
    minSelfBond: "0",
    selfBondGraceUntil: "0",
    selfBondRuleActive: false,
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
    // v1 has no permissionless join at all, so "paused" is the honest reading.
    joinsPaused: true,
    governanceSyncEnabled: false,
    // No separate set counter on v1; every active operator is in the consensus set,
    // which is exactly what activeOperatorCount counts.
    validatorCount: String(state.activeOperatorCount || "0"),
    trackedUsdst: "0",
    unattributedFees: "0",
    totalFeesCredited: "0",
    totalRewardsCredited: "0",
    userTotalStake: userTotalStake.toString(),
    userTotalStakeUsd: stratoPriceWad > 0n ? ((userTotalStake * stratoPriceWad) / WAD).toString() : "0",
    claimableRewards: claimableRewards.toString(),
    claimableFees: "0",
    totalEarned: (
      lifetimeClaimedRewards +
      claimableRewards +
      operatorPendingBaseRewards +
      operatorPendingCommission +
      operatorPendingSelfBondRewards
    ).toString(),
    isOperator,
    operatedValidators: isOperator ? [connectedOperatorAddress] : [],
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

// v2: validator-keyed records from one bloc snapshot. Per-user checkpoints come from the
// same snapshot as the indexes they are measured against, so a claim can never show as
// still pending because Cirrus lagged on one side. Income is pushed per block (block
// rewards, proposer fees), so nothing is projected over time; the frozen schedule indexes
// are not projected either (records on helium are already level with them, and any
// remainder is pendingBaseRewards).
const getV2StakingInfo = async (
  accessToken: string,
  state: Record<string, any>,
  userAddress?: string
): Promise<StratoStakingInfo> => {
  const tokenAddress = normalizeAddress(state.stratoToken) || stratoTokenAddress();
  const user = normalizeAddress(userAddress);

  const [
    tokenInfo,
    walletBalance,
    validatorProfiles,
    lifetimeClaimedRewards,
    stratoPriceWad,
    recentRewards,
  ] = await Promise.all([
    getTokenInfo(accessToken, tokenAddress),
    getTokenBalance(accessToken, tokenAddress, user),
    getValidatorProfiles(accessToken),
    getLifetimeClaimedRewards(accessToken, user),
    getStratoTokenPriceWad(accessToken),
    getRecentBlockRewards(accessToken),
  ] as const);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const userStakes = userRow(state.delegatedStake, user);
  const userPendingRewards = userRow(state.pendingDelegatorRewards, user);
  const userRewardPaid = userRow(state.userRewardPerStakePaid, user);
  const userPendingFees = userRow(state.pendingDelegatorFees, user);
  const userFeePaid = userRow(state.userFeePerStakePaid, user);
  const blocksProposedMap = addressKeyed(state.blocksProposed);
  const missedProposalsMap = addressKeyed(state.missedProposals);
  const consecutiveMissesMap = addressKeyed(state.consecutiveMisses);

  let userTotalStake = 0n;
  let claimableRewards = 0n;
  let claimableFees = 0n;
  let userWeightedApyBps = 0n;
  let activeValidatorCount = 0n;
  let operatorClaimableTotal = 0n;
  const operated: Array<{ record: V2ValidatorRecord; rewards: bigint; fees: bigint }> = [];

  const records = v2ValidatorRecords(state);
  const validators = records.map((record): StratoOperatorInfo => {
    const { validator, value } = record;
    const profile = validatorProfiles.get(validator) || {};
    const userStake = parseBigIntLike(userStakes.get(validator));

    const rewardIndex = parseBigIntLike(value.delegatorRewardPerStakeStored);
    const rewardPaid = parseBigIntLike(userRewardPaid.get(validator));
    const pendingRewards = parseBigIntLike(userPendingRewards.get(validator))
      + (userStake > 0n && rewardIndex > rewardPaid ? (userStake * (rewardIndex - rewardPaid)) / WAD : 0n);

    const feeIndex = parseBigIntLike(value.feePerStakeStored);
    const feePaid = parseBigIntLike(userFeePaid.get(validator));
    const pendingFees = parseBigIntLike(userPendingFees.get(validator))
      + (userStake > 0n && feeIndex > feePaid ? (userStake * (feeIndex - feePaid)) / WAD : 0n);

    // claimOperatorRewards pays self-bond share + commission, after folding any retired
    // schedule remainder (pendingBaseRewards) into the self-bond share.
    const operatorPendingRewards = parseBigIntLike(value.pendingSelfBondRewards)
      + parseBigIntLike(value.pendingCommission)
      + parseBigIntLike(value.pendingBaseRewards);
    const operatorPendingFees = parseBigIntLike(value.pendingSelfBondFees) + parseBigIntLike(value.pendingFeeCommission);

    const apyBps = realizedApyBps(
      recentRewards.get(validator) || 0n,
      record.totalStake,
      effectiveCommissionBps(state, record.commissionBps)
    );

    if (user && record.operator === user) {
      operated.push({ record, rewards: operatorPendingRewards, fees: operatorPendingFees });
      operatorClaimableTotal += operatorPendingRewards;
    }
    if (record.active) activeValidatorCount += 1n;

    userTotalStake += userStake;
    claimableRewards += pendingRewards;
    claimableFees += pendingFees;
    userWeightedApyBps += userStake * apyBps;

    return {
      address: validator,
      active: record.active,
      registryActive: parseBoolLike(profile.active),
      operator: record.operator,
      name: String(profile.name || ""),
      description: String(profile.description || ""),
      metadataURI: String(profile.metadataURI || ""),
      protocolValidatorId: String(profile.protocolValidatorId || ""),
      validatorAddress: validator,
      status: record.status,
      isValidator: record.isValidator,
      eligible: record.eligible,
      isWaiter: record.eligible && !record.isValidator,
      jailedUntil: record.jailedUntil.toString(),
      exitReadyTime: record.exitReadyTime.toString(),
      blocksProposed: uintString(blocksProposedMap.get(validator)),
      missedProposals: uintString(missedProposalsMap.get(validator)),
      consecutiveMisses: uintString(consecutiveMissesMap.get(validator)),
      commissionBps: record.commissionBps.toString(),
      selfBond: record.selfBond.toString(),
      delegatedStake: record.delegatedStake.toString(),
      totalStake: record.totalStake.toString(),
      estimatedApy: formatBpsAsPercent(apyBps),
      userStake: userStake.toString(),
      pendingRewards: pendingRewards.toString(),
      pendingFees: pendingFees.toString(),
      operatorPendingRewards: operatorPendingRewards.toString(),
      operatorPendingFees: operatorPendingFees.toString(),
    };
  });

  // Your actual (stake-weighted) APY once you're delegated; the network's realized APY
  // until then.
  const networkBps = networkApyBps(state, recentRewards);
  const estimatedApy = userTotalStake > 0n
    ? formatBpsAsPercent(userWeightedApyBps / userTotalStake)
    : networkBps > 0n
      ? formatBpsAsPercent(networkBps)
      : "-";

  const primary = operated[0];
  const totalRewardableStake = parseBigIntLike(state.totalRewardableStake);

  return {
    configured: true,
    deployed: true,
    contractVersion: "v2",
    validatorSetDeployed: true,
    stakingAddress: stakingAddress(),
    validatorRegistryAddress: validatorRegistryAddress(),
    stratoTokenAddress: tokenAddress,
    usdstTokenAddress: normalizeAddress(state.usdstToken),
    ...tokenInfo,
    walletBalance,
    totalUserStake: uintString(state.totalUserStake),
    totalSelfBond: uintString(state.totalSelfBond),
    totalUnbonding: uintString(state.totalUnbonding),
    totalRewardableStake: totalRewardableStake.toString(),
    totalRewardableStakeUsd: stratoPriceWad > 0n ? ((totalRewardableStake * stratoPriceWad) / WAD).toString() : "0",
    activeValidatorCount: activeValidatorCount.toString(),
    rewardReserve: "0",
    rewardPeriodAmount: "0",
    scheduledRewardRemaining: "0",
    baseRewardBps: "0",
    maxCommissionBps: uintString(state.maxCommissionBps),
    maxBatchSize: uintString(state.maxBatchSize),
    unbondingSeconds: uintString(state.unbondingSeconds),
    periodStart: "0",
    periodFinish: "0",
    rewardPeriodName: "",
    rewardPeriodDescription: "",
    baseRewardRate: "0",
    stakeRewardRate: "0",
    estimatedApy,
    minStake: uintString(state.minStake),
    minSelfBond: "0",
    selfBondGraceUntil: uintString(state.selfBondGraceUntil),
    selfBondRuleActive: isSelfBondRuleActive(state, now),
    proposerFeeBps: uintString(state.proposerFeeBps),
    maxConsecutiveMisses: uintString(state.maxConsecutiveMisses),
    jailCooldown: uintString(state.jailCooldown),
    maxActiveValidators: uintString(state.maxActiveValidators),
    hardCapActiveValidators: uintString(state.hardCapActiveValidators),
    evictionMarginBps: uintString(state.evictionMarginBps),
    maxSetMutationsPerBlock: uintString(state.maxSetMutationsPerBlock),
    exitNoticeSeconds: uintString(state.exitNoticeSeconds),
    unkickCooldown: uintString(state.unkickCooldown),
    maxOperatorStakeBps: uintString(state.maxOperatorStakeBps),
    joinsPaused: parseBoolLike(state.joinsPaused),
    governanceSyncEnabled: parseBoolLike(state.governanceSyncEnabled),
    validatorCount: uintString(state.validatorCount),
    trackedUsdst: uintString(state.trackedUsdst),
    unattributedFees: uintString(state.unattributedFees),
    totalFeesCredited: uintString(state.totalFeesCredited),
    totalRewardsCredited: uintString(state.totalRewardsCredited),
    userTotalStake: userTotalStake.toString(),
    userTotalStakeUsd: stratoPriceWad > 0n ? ((userTotalStake * stratoPriceWad) / WAD).toString() : "0",
    claimableRewards: claimableRewards.toString(),
    claimableFees: claimableFees.toString(),
    totalEarned: (lifetimeClaimedRewards + claimableRewards + operatorClaimableTotal).toString(),
    isOperator: operated.length > 0,
    operatedValidators: operated.map(({ record }) => record.validator),
    operatorAddress: primary?.record.validator || "",
    operatorStatus: primary?.record.status || 0,
    operatorClaimableRewards: (primary?.rewards || 0n).toString(),
    operatorClaimableFees: (primary?.fees || 0n).toString(),
    operatorPendingBaseRewards: "0",
    operatorPendingCommission: uintString(primary?.record.value.pendingCommission),
    // The retired schedule's remainder settles into the self-bond share, so it is
    // reported there and the parts still add up to operatorClaimableRewards.
    operatorPendingSelfBondRewards: primary
      ? (parseBigIntLike(primary.record.value.pendingSelfBondRewards) + parseBigIntLike(primary.record.value.pendingBaseRewards)).toString()
      : "0",
    currentOperatorCommissionBps: (primary?.record.commissionBps || 0n).toString(),
    validators,
    unbondingRequests: v2UnbondingRequests(state, user),
  };
};

// ---- transactions ----

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

const stakingCall = (method: string, args: Record<string, unknown> = {}): FunctionInput => ({
  contractName: extractContractName(StratoStaking),
  contractAddress: requireStakingAddress(),
  method,
  args,
});

const registryCall = (method: string, args: Record<string, unknown> = {}): FunctionInput => ({
  contractName: extractContractName(ValidatorRegistry),
  contractAddress: requireValidatorRegistryAddress(),
  method,
  args,
});

const requireValidatorArg = (validator: unknown): string => {
  const address = normalizeAddress(validator);
  if (!isNormalizedAddress(address)) throw badRequest("validator is required");
  return address;
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
      validator: normalizeAddress(delegation.validator),
      amount: String(delegation.amount || "0"),
    }))
    .filter((delegation) => delegation.validator && parseBigIntLike(delegation.amount) > 0n);

  if (!normalized.length) {
    throw new Error("At least one delegation is required");
  }

  return normalized;
};

// Stake targets are validators on v2 and operators on v1; the call shapes match.
export const stakeStrato = async (
  accessToken: string,
  userAddress: string,
  delegations: StakeDelegationInput[]
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  const token = requireStratoTokenAddress();
  const version = await requireContractVersion(accessToken);
  const normalized = normalizeDelegations(delegations);
  const maxBatchSize = await getMaxBatchSize(accessToken);
  assertWithinMaxBatchSize(normalized.length, maxBatchSize, "Delegations");

  const totalAmount = normalized.reduce((sum, delegation) => sum + parseBigIntLike(delegation.amount), 0n);
  const allowance = await getTokenAllowance(accessToken, token, userAddress, staking);

  const targets = normalized.map(({ validator }) => validator);
  const amounts = normalized.map(({ amount }) => amount);
  const stakeTx: FunctionInput = normalized.length === 1
    ? stakingCall("stake", version === "v2"
        ? { validator: targets[0], amount: amounts[0] }
        : { operator: targets[0], amount: amounts[0] })
    : stakingCall("stakeBatch", version === "v2"
        ? { validators: targets, amounts }
        : { stakeOperators: targets, amounts });

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
  fromValidator: string,
  toValidator: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);
  const from = normalizeAddress(fromValidator);
  const to = normalizeAddress(toValidator);

  return await buildAndPost(accessToken, userAddress, stakingCall("moveStake", version === "v2"
    ? { fromValidator: from, toValidator: to, amount }
    : { fromOperator: from, toOperator: to, amount }));
};

export const unstakeStrato = async (
  accessToken: string,
  userAddress: string,
  validator: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);
  const target = normalizeAddress(validator);

  return await buildAndPost(accessToken, userAddress, stakingCall("unstake", version === "v2"
    ? { validator: target, amount }
    : { operator: target, amount }));
};

// Resolve the records a delegator claim covers: the ones named, or every record with
// something pending, chunked to maxBatchSize.
const resolveClaimTargets = async (
  accessToken: string,
  userAddress: string,
  targets: string[] | undefined,
  claimAll: boolean,
  pending: (validator: StratoOperatorInfo) => string,
  label: string
): Promise<string[][]> => {
  let claimTargets = (targets || []).map(normalizeAddress).filter(Boolean);
  let maxBatchSize = claimTargets.length || 1;

  if (claimAll) {
    const info = await getStratoStakingInfo(accessToken, userAddress);
    maxBatchSize = batchSizeFromInfo(info);
    claimTargets = info.validators
      .filter((validator) => parseBigIntLike(pending(validator)) > 0n)
      .map((validator) => validator.address);
  } else if (claimTargets.length) {
    maxBatchSize = await getMaxBatchSize(accessToken);
    assertWithinMaxBatchSize(claimTargets.length, maxBatchSize, "Claim validators");
  }

  if (!claimTargets.length) {
    throw new Error(`No validators selected for ${label} claim`);
  }

  return chunkByMaxBatchSize(claimTargets, maxBatchSize);
};

export const claimStratoRewards = async (
  accessToken: string,
  userAddress: string,
  validators?: string[],
  claimAll = false
): Promise<{ status: string; hash: string }> => {
  requireStakingAddress();
  const version = await requireContractVersion(accessToken);
  const batches = await resolveClaimTargets(
    accessToken, userAddress, validators, claimAll, (validator) => validator.pendingRewards, "reward");

  return await buildAndPost(accessToken, userAddress, batches.map((batch) =>
    stakingCall("claimRewards", version === "v2" ? { validators: batch } : { claimOperators: batch })));
};

export const claimStratoOperatorRewards = async (
  accessToken: string,
  userAddress: string,
  validator?: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);

  return await buildAndPost(accessToken, userAddress, version === "v2"
    ? stakingCall("claimOperatorRewards", { validator: requireValidatorArg(validator) })
    : stakingCall("claimOperatorRewards"));
};

// USDST proposer fees have their own claim path, separate from STRATO rewards.
export const claimStratoFeeRewards = async (
  accessToken: string,
  userAddress: string,
  validators?: string[],
  claimAll = false
): Promise<{ status: string; hash: string }> => {
  requireStakingAddress();
  await requireV2(accessToken);
  const batches = await resolveClaimTargets(
    accessToken, userAddress, validators, claimAll, (validator) => validator.pendingFees, "fee");

  return await buildAndPost(accessToken, userAddress, batches.map((batch) =>
    stakingCall("claimFeeRewards", { validators: batch })));
};

export const claimStratoOperatorFeeRewards = async (
  accessToken: string,
  userAddress: string,
  validator?: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await buildAndPost(accessToken, userAddress,
    stakingCall("claimOperatorFeeRewards", { validator: requireValidatorArg(validator) }));
};

// ---- validator lifecycle (operator / permissionless) ----

// The registry's operator-authorization message: keccak256 over the packed encoding of the
// prefix, registry, validator, operator and uint256 nonce, with no signed-message prefix
// (ValidatorRegistry.authorizationDigest).
const AUTHORIZATION_PREFIX = "STRATO validator operator authorization";

const authorizationDigest = (registry: string, validator: string, operator: string, nonce: bigint): string => {
  const packed = Buffer.concat([
    Buffer.from(AUTHORIZATION_PREFIX, "utf8"),
    Buffer.from(registry, "hex"),
    Buffer.from(validator, "hex"),
    Buffer.from(operator, "hex"),
    Buffer.from(nonce.toString(16).padStart(64, "0"), "hex"),
  ]);
  return `0x${keccak256(packed).toString("hex")}`;
};

export const getStratoAuthorizationDigest = async (
  accessToken: string,
  validator: string,
  operator: string
): Promise<StratoAuthorizationDigest> => {
  const registry = requireValidatorRegistryAddress();
  const validatorAddress = requireValidatorArg(validator);
  const operatorAddress = normalizeAddress(operator);
  if (!isNormalizedAddress(operatorAddress)) throw badRequest("operator is required");
  await requireV2(accessToken);

  // Read fresh: every register/setOperator spends the nonce, and a digest over a spent
  // nonce can never be accepted. Absent from state = never spent = 0.
  const registryState = await getBlocState(accessToken, extractContractName(ValidatorRegistry), registry, true);
  const nonce = parseBigIntLike(addressKeyed(registryState.authorizationNonce).get(validatorAddress));

  return {
    registry,
    validator: validatorAddress,
    operator: operatorAddress,
    nonce: nonce.toString(),
    digest: authorizationDigest(registry, validatorAddress, operatorAddress, nonce),
  };
};

// r || s || v as 130 hex characters. r and s travel as decimal strings (uint256
// parameters); v may be a recovery id (0/1) or 27/28, as the registry accepts both.
const splitSignature = (signature: unknown): { v: string; r: string; s: string } | null => {
  if (signature === undefined || signature === null || signature === "") return null;

  const hex = String(signature).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{130}$/.test(hex)) {
    throw badRequest("signature must be 0x followed by 130 hex characters (r, s, v)");
  }
  const v = parseInt(hex.slice(128), 16);
  if (![0, 1, 27, 28].includes(v)) {
    throw badRequest("signature v must be 0, 1, 27 or 28");
  }

  return {
    r: BigInt(`0x${hex.slice(0, 64)}`).toString(),
    s: BigInt(`0x${hex.slice(64, 128)}`).toString(),
    v: String(v),
  };
};

// List a validator with msg.sender as its operator; joining the consensus set is a
// separate tryActivate. Needs the validator key's consent unless the key itself sends it.
export const registerStratoOperator = async (
  accessToken: string,
  userAddress: string,
  input: RegisterValidatorInput
): Promise<{ status: string; hash: string }> => {
  const validator = requireValidatorArg(input.validator);
  if (input.commissionBps === undefined || input.commissionBps === "") throw badRequest("commissionBps is required");
  await requireV2(accessToken);

  const signature = splitSignature(input.signature);
  if (!signature && validator !== normalizeAddress(userAddress)) {
    throw badRequest(
      "signature is required: the validator key must sign the operator authorization digest (GET /staking/authorization-digest)"
    );
  }

  return await buildAndPost(accessToken, userAddress, registryCall("register", {
    validator,
    commissionBps: String(input.commissionBps),
    name: String(input.name || ""),
    description: String(input.description || ""),
    metadataURI: String(input.metadataURI || ""),
    // Ignored by the registry when the validator key is the sender.
    v: signature?.v ?? "0",
    r: signature?.r ?? "0",
    s: signature?.s ?? "0",
  }));
};

export const updateStratoOperatorProfile = async (
  accessToken: string,
  userAddress: string,
  input: ValidatorProfileInput
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);
  const profile = {
    name: String(input.name || ""),
    description: String(input.description || ""),
    metadataURI: String(input.metadataURI || ""),
    protocolValidatorId: String(input.protocolValidatorId || ""),
  };

  return await buildAndPost(accessToken, userAddress, version === "v2"
    ? registryCall("updateProfile", { validator: requireValidatorArg(input.validator), ...profile })
    : registryCall("updateProfile", { operator: normalizeAddress(userAddress), ...profile }));
};

// Put an eligible validator into the consensus set.
export const activateStratoOperator = async (
  accessToken: string,
  userAddress: string,
  validator?: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("tryActivate", {
    validator: requireValidatorArg(validator),
  }));
};

// Fill free set slots from the waiters, best first. reconcileSet only considers the
// candidates it is handed (at most maxBatchSize), so the backend does the indexing.
export const reconcileStratoValidatorSet = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  const state = await getStakingBlocState(accessToken, true);
  const candidates = v2ValidatorRecords(state)
    .filter((record) => record.eligible && !record.isValidator)
    .sort((a, b) =>
      a.totalStake !== b.totalStake
        ? (b.totalStake > a.totalStake ? 1 : -1)
        : (a.validator < b.validator ? -1 : 1))
    .slice(0, batchSizeFromValue(state.maxBatchSize))
    .map((record) => record.validator);

  if (!candidates.length) {
    throw badRequest("No eligible validators are waiting to join the set");
  }

  return await buildAndPost(accessToken, userAddress, stakingCall("reconcileSet", { candidates }));
};

export const syncStratoValidator = async (
  accessToken: string,
  userAddress: string,
  validator?: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("syncValidator", {
    validator: requireValidatorArg(validator),
  }));
};

export const requestStratoExit = async (
  accessToken: string,
  userAddress: string,
  validator?: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("requestExit", {
    validator: requireValidatorArg(validator),
  }));
};

export const cancelStratoExit = async (
  accessToken: string,
  userAddress: string,
  validator?: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await buildAndPost(accessToken, userAddress, stakingCall("cancelExit", {
    validator: requireValidatorArg(validator),
  }));
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

// ---- operator stake and commission ----

// v1 operator calls act on msg.sender's own record; v2 names the validator record.
export const setStratoCommission = async (
  accessToken: string,
  userAddress: string,
  validator: string | undefined,
  commissionBps: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);

  return await buildAndPost(accessToken, userAddress, version === "v2"
    ? stakingCall("setCommissionBps", { validator: requireValidatorArg(validator), newCommissionBps: commissionBps })
    : stakingCall("setCommissionBps", { newCommissionBps: commissionBps }));
};

export const setStratoOperatorCommission = async (
  accessToken: string,
  userAddress: string,
  validator: string,
  commissionBps: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);

  return castVoteOnIssue(
    accessToken,
    userAddress,
    requireStakingAddress(),
    version === "v2" ? "setValidatorCommissionBps" : "setOperatorCommissionBps",
    [normalizeAddress(validator), commissionBps]
  );
};

export const selfBondStrato = async (
  accessToken: string,
  userAddress: string,
  validator: string | undefined,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  const token = requireStratoTokenAddress();
  const version = await requireContractVersion(accessToken);
  const bondTx = version === "v2"
    ? stakingCall("selfBond", { validator: requireValidatorArg(validator), amount })
    : stakingCall("selfBond", { amount });

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
    bondTx,
  ]);
};

export const unbondSelfStrato = async (
  accessToken: string,
  userAddress: string,
  validator: string | undefined,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);

  return await buildAndPost(accessToken, userAddress, version === "v2"
    ? stakingCall("unbondSelf", { validator: requireValidatorArg(validator), amount })
    : stakingCall("unbondSelf", { amount }));
};

export const depositStratoRewards = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const staking = requireStakingAddress();
  const token = requireStratoTokenAddress();
  await requireV1(accessToken, "Reward deposits");

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
    stakingCall("depositRewards", { amount }),
  ]);
};

// ---- admin (owner votes) ----

// v2 lists validator/operator pairs (addValidator); v1 lists operators (addOperator).
export const addStratoOperator = async (
  accessToken: string,
  userAddress: string,
  input: AddStratoOperatorInput | AddStratoOperatorInput[]
): Promise<{ status: string; hash: string }> => {
  const listings = (Array.isArray(input) ? input : [input]).map((item) => ({
    validator: normalizeAddress(item.validator),
    operator: normalizeAddress(item.operator),
    commissionBps: String(item.commissionBps ?? ""),
    name: String(item.name || ""),
    description: String(item.description || ""),
    metadataURI: String(item.metadataURI || ""),
    protocolValidatorId: String(item.protocolValidatorId || ""),
  }));

  if (!listings.length || listings.some((item) => !item.operator || item.commissionBps === "")) {
    throw badRequest("At least one operator is required");
  }

  const registry = requireValidatorRegistryAddress();
  const version = await requireContractVersion(accessToken);

  if (version === "v2") {
    if (listings.some((item) => !isNormalizedAddress(item.validator))) {
      throw badRequest("validator is required for every listing");
    }
    if (listings.length === 1) {
      const item = listings[0];
      return castVoteOnIssue(accessToken, userAddress, registry, "addValidator", [
        item.validator,
        item.operator,
        item.commissionBps,
        item.name,
        item.description,
        item.metadataURI,
        item.protocolValidatorId,
      ]);
    }
    return castVoteOnIssue(accessToken, userAddress, registry, "addValidators", [
      listings.map(({ validator }) => validator),
      listings.map(({ operator }) => operator),
      listings.map(({ commissionBps }) => commissionBps),
      listings.map(({ name }) => name),
      listings.map(({ description }) => description),
      listings.map(({ metadataURI }) => metadataURI),
      listings.map(({ protocolValidatorId }) => protocolValidatorId),
    ]);
  }

  if (listings.length === 1) {
    const item = listings[0];
    return castVoteOnIssue(accessToken, userAddress, registry, "addOperator", [
      item.operator,
      item.commissionBps,
      item.name,
      item.description,
      item.metadataURI,
      item.protocolValidatorId,
    ]);
  }

  return castVoteOnIssue(accessToken, userAddress, registry, "addOperators", [
    listings.map(({ operator }) => operator),
    listings.map(({ commissionBps }) => commissionBps),
    listings.map(({ name }) => name),
    listings.map(({ description }) => description),
    listings.map(({ metadataURI }) => metadataURI),
    listings.map(({ protocolValidatorId }) => protocolValidatorId),
  ]);
};

export const removeStratoOperator = async (
  accessToken: string,
  userAddress: string,
  validator: string
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);

  return castVoteOnIssue(
    accessToken,
    userAddress,
    requireValidatorRegistryAddress(),
    version === "v2" ? "removeValidator" : "removeOperator",
    [normalizeAddress(validator)]
  );
};

// Hand a validator to a new operator without the validator key's signature (the admins
// vouch for it). Staking pays out and unbonds what the outgoing operator owns.
export const setStratoValidatorOperator = async (
  accessToken: string,
  userAddress: string,
  validator: string,
  operator: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireValidatorRegistryAddress(), "adminSetOperator", [
    requireValidatorArg(validator),
    normalizeAddress(operator),
  ]);
};

// Only the retired operator-keyed V2 registry had setValidatorAddress. The V1 registry never
// had it (a vote would fail on execution), and v2 records are keyed by validator, so there is
// nothing separate to set.
export const setStratoValidatorAddress = async (
  accessToken: string,
  _userAddress: string,
  _operator: string,
  _validatorAddress: string
): Promise<{ status: string; hash: string }> => {
  if ((await requireContractVersion(accessToken)) === "v2") {
    throw badRequest(
      "Validator records are keyed by validator address on this network; use PATCH /staking/admin/operators/operator to change a validator's operator."
    );
  }
  throw badRequest("This network's validator registry has no validator address binding.");
};

export const setStratoEmergencyKicker = async (
  accessToken: string,
  userAddress: string,
  kicker: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireValidatorRegistryAddress(), "setEmergencyKicker", [
    normalizeAddress(kicker),
  ]);
};

export const startStratoRewardSchedule = async (
  accessToken: string,
  userAddress: string,
  rewardAmount: string,
  startTime: string,
  duration: string,
  baseRewardBps: string,
  name: string,
  description: string
): Promise<{ status: string; hash: string }> => {
  await requireV1(accessToken, "Reward schedules");

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "startRewardSchedule", [
    rewardAmount,
    startTime,
    duration,
    baseRewardBps,
    name,
    description,
  ]);
};

export const stopStratoRewardSchedule = async (
  accessToken: string,
  userAddress: string
): Promise<{ status: string; hash: string }> => {
  await requireV1(accessToken, "Reward schedules");

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "stopRewardSchedule", []);
};

// v2 dropped baseRewardBps with the reward schedule.
export const setStratoStakingParams = async (
  accessToken: string,
  userAddress: string,
  args: {
    unbondingSeconds: string;
    baseRewardBps?: string;
    maxCommissionBps: string;
    maxBatchSize: string;
  }
): Promise<{ status: string; hash: string }> => {
  const version = await requireContractVersion(accessToken);
  if (version === "v2") {
    return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setParams", [
      args.unbondingSeconds,
      args.maxCommissionBps,
      args.maxBatchSize,
    ]);
  }

  if (args.baseRewardBps === undefined || args.baseRewardBps === "") {
    throw badRequest("baseRewardBps is required");
  }
  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setParams", [
    args.unbondingSeconds,
    args.baseRewardBps,
    args.maxCommissionBps,
    args.maxBatchSize,
  ]);
};

export const setStratoValidatorParams = async (
  accessToken: string,
  userAddress: string,
  args: {
    minStake: string;
    proposerFeeBps: string;
    maxConsecutiveMisses: string;
    jailCooldown: string;
  }
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setValidatorParams", [
    args.minStake,
    args.proposerFeeBps,
    args.maxConsecutiveMisses,
    args.jailCooldown,
  ]);
};

// End of the self-bond grace period (unix seconds). A time in the past applies the
// self-bond rule immediately and drops under-bonded validators from the set.
export const setStratoSelfBondGrace = async (
  accessToken: string,
  userAddress: string,
  selfBondGraceUntil: string
): Promise<{ status: string; hash: string }> => {
  if (parseBigIntLike(selfBondGraceUntil) <= 0n) throw badRequest("selfBondGraceUntil must be positive");
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "setSelfBondGraceUntil", [
    selfBondGraceUntil,
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
  await requireV2(accessToken);

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
  await requireV2(accessToken);

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
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, requireStakingAddress(), "recoverUnattributedFees", [
    normalizeAddress(to),
    amount,
  ]);
};

// MercataGovernance (0x100): wire the staking contract and bound the validator set.
// Governance grew its staking hooks in the same rollout, so it is gated on v2.
export const setGovernanceStakingContract = async (
  accessToken: string,
  userAddress: string,
  stakingContract?: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, normalizeAddress(constants.mercataGovernance), "setStakingContract", [
    normalizeAddress(stakingContract) || requireStakingAddress(),
  ]);
};

export const setGovernanceHardCap = async (
  accessToken: string,
  userAddress: string,
  hardCap: string
): Promise<{ status: string; hash: string }> => {
  await requireV2(accessToken);

  return await castVoteOnIssue(accessToken, userAddress, normalizeAddress(constants.mercataGovernance), "setHardCapValidators", [
    hardCap,
  ]);
};
