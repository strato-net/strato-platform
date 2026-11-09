import { cirrus, strato } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { vestingPoolAddress } from "../../config/config";
import { extractContractName } from "../../utils/utils";
import { StratoError } from "../../errors";

// VestingPool.claimVestedTokens treats max uint128 as "claim everything available".
export const MAX_UINT128 = "340282366920938463463374607431768211455";
export const WEEK_SECONDS = 604800;

// Accrual is reported from the Cirrus row, not from the contract: the public
// vestings(id) getter returns empty fields over RPC and calculateVestedAmount
// reverts before startDate, which is exactly the state the page must show.

export type VestingStatus = "not_started" | "vesting" | "paused" | "cancelled" | "fully_vested" | "complete";

// Atom amounts as decimal strings, times as unix seconds. pausingDate is 0 when not paused.
export interface VestingView {
  vestingId: string;
  account: string;
  managed: boolean;
  cancelled: boolean;
  curveType: number;
  durationWeeks: number;
  durationSeconds: number;
  startDate: number;
  endDate: number;
  pausingDate: number;
  amount: string;
  amountClaimed: string;
  vested: string;
  claimable: string;
  // Still to vest. For a cancelled vesting this is 0 and `returned` holds the remainder.
  locked: string;
  // Unvested remainder that went back to the pool when the vesting was cancelled, else "0".
  returned: string;
  ratePerSecond: string;
  status: VestingStatus;
}

export interface VestingSummary {
  amount: string;
  vested: string;
  claimed: string;
  claimable: string;
  locked: string;
  returned: string;
}

export interface VestingsResponse {
  pool: string | null;
  vestings: VestingView[];
  summary: VestingSummary;
}

// The Vesting struct as stored on-chain, normalised from a Cirrus mapping row.
export interface ParsedVesting {
  vestingId: string;
  account: string;
  curveType: number;
  managed: boolean;
  durationWeeks: number;
  startDate: number;
  amount: bigint;
  amountClaimed: bigint;
  pausingDate: number;
  cancelled: boolean;
}

interface VestingRow {
  key: string;
  value: unknown;
}

// ---- row normalisation ----

// Cirrus renders a zero struct field as a 40-zero string ("000...0"), otherwise as a
// decimal string or a JSON number. BigInt(String(x)) accepts all three forms.
const toBigInt = (value: unknown): bigint => {
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "boolean") return value ? 1n : 0n;
  return BigInt(String(value).trim());
};

const toNumber = (value: unknown): number => Number(toBigInt(value));

// Booleans arrive as true/false or "true"/"false".
const toBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : String(value ?? "").trim().toLowerCase() === "true";

const normalizeHex = (value: unknown): string =>
  String(value ?? "").trim().replace(/^0x/i, "").toLowerCase();

export const parseVestingRow = (row: VestingRow): ParsedVesting => {
  // The value column is a JSON object, but some Cirrus paths hand it back as a JSON string.
  const raw = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  return {
    vestingId: normalizeHex(row.key),
    account: normalizeHex(value.account),
    curveType: toNumber(value.curveType),
    managed: toBoolean(value.managed),
    durationWeeks: toNumber(value.durationWeeks),
    startDate: toNumber(value.startDate),
    amount: toBigInt(value.amount),
    amountClaimed: toBigInt(value.amountClaimed),
    pausingDate: toNumber(value.pausingDate),
    cancelled: toBoolean(value.cancelled),
  };
};

// ---- accrual, mirroring VestingPool._calculateVestedAmount ----

export const computeVestingView = (parsed: ParsedVesting, nowSeconds: number): VestingView => {
  const durationSeconds = parsed.durationWeeks * WEEK_SECONDS;
  const started = nowSeconds >= parsed.startDate;
  // Pause and cancel both set pausingDate (never below startDate) and freeze accrual there.
  const effective = parsed.pausingDate > 0 ? parsed.pausingDate : nowSeconds;
  const elapsed = Math.max(0, effective - parsed.startDate);
  const ended = elapsed >= durationSeconds;

  let vested = 0n;
  if (!started) {
    // The contract's view reverts "Vesting not active yet" here; nothing is vested.
    vested = 0n;
  } else if (ended) {
    // Also the durationWeeks == 0 case: fully vested at startDate.
    vested = parsed.amount;
  } else if (parsed.curveType === 0) {
    vested = (parsed.amount * BigInt(elapsed)) / BigInt(durationSeconds);
  } else if (parsed.curveType === 1) {
    const elapsedBig = BigInt(elapsed);
    const durationBig = BigInt(durationSeconds);
    vested = (parsed.amount * elapsedBig * elapsedBig) / (durationBig * durationBig);
  }
  // Any other curve type is unreachable: addVesting rejects it.

  const claimable = vested > parsed.amountClaimed ? vested - parsed.amountClaimed : 0n;
  // Cancelling returns the unvested remainder to the pool: the beneficiary never gets it,
  // so it is reported as returned rather than locked.
  const unvested = parsed.amount - vested;
  const locked = parsed.cancelled ? 0n : unvested;
  const returned = parsed.cancelled ? unvested : 0n;
  const ratePerSecond = durationSeconds > 0 ? parsed.amount / BigInt(durationSeconds) : 0n;

  // A pause before the start (pausingDate == startDate) still reads not_started so the
  // countdown applies, and a pause after the end changes nothing, so ended wins over paused.
  let status: VestingStatus;
  if (parsed.cancelled) {
    status = claimable === 0n ? "complete" : "cancelled";
  } else if (!started) {
    status = "not_started";
  } else if (ended) {
    status = claimable > 0n ? "fully_vested" : "complete";
  } else if (parsed.pausingDate > 0) {
    status = "paused";
  } else {
    status = "vesting";
  }

  return {
    vestingId: parsed.vestingId,
    account: parsed.account,
    managed: parsed.managed,
    cancelled: parsed.cancelled,
    curveType: parsed.curveType,
    durationWeeks: parsed.durationWeeks,
    durationSeconds,
    startDate: parsed.startDate,
    // While paused this is a lower bound: unpause shifts startDate forward by the paused time.
    endDate: parsed.startDate + durationSeconds,
    pausingDate: parsed.pausingDate,
    amount: parsed.amount.toString(),
    amountClaimed: parsed.amountClaimed.toString(),
    vested: vested.toString(),
    claimable: claimable.toString(),
    locked: locked.toString(),
    returned: returned.toString(),
    ratePerSecond: ratePerSecond.toString(),
    status,
  };
};

export const summarise = (views: VestingView[]): VestingSummary => {
  const totals = { amount: 0n, vested: 0n, claimed: 0n, claimable: 0n, locked: 0n, returned: 0n };
  for (const view of views) {
    totals.amount += BigInt(view.amount);
    totals.vested += BigInt(view.vested);
    totals.claimed += BigInt(view.amountClaimed);
    totals.claimable += BigInt(view.claimable);
    totals.locked += BigInt(view.locked);
    totals.returned += BigInt(view.returned);
  }
  return {
    amount: totals.amount.toString(),
    vested: totals.vested.toString(),
    claimed: totals.claimed.toString(),
    claimable: totals.claimable.toString(),
    locked: totals.locked.toString(),
    returned: totals.returned.toString(),
  };
};

// ---- reads ----

const emptySummary = (): VestingSummary =>
  ({ amount: "0", vested: "0", claimed: "0", claimable: "0", locked: "0", returned: "0" });

const vestingsTable = (): string => `/${constants.VestingPool}-vestings`;

// The pool's rows for one account. The PostgREST JSON filter (value->>account) is
// tried first; if Cirrus rejects it, the pool's rows are fetched and filtered here.
// Callers filter by account again either way.
const fetchVestingRows = async (
  accessToken: string,
  pool: string,
  account: string
): Promise<VestingRow[]> => {
  const baseParams = { address: `eq.${pool}`, select: "key,value", limit: 5000 };

  try {
    const { data } = await cirrus.get(accessToken, vestingsTable(), {
      params: { ...baseParams, "value->>account": `eq.${account}` },
    });
    if (Array.isArray(data)) return data;
  } catch (error: any) {
    console.warn(`[vesting] account filter rejected by Cirrus, fetching pool rows: ${error?.message || error}`);
  }

  const { data } = await cirrus.get(accessToken, vestingsTable(), { params: baseParams });
  return Array.isArray(data) ? data : [];
};

export const getVestingsForAddress = async (
  accessToken: string,
  address: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<VestingsResponse> => {
  const pool = vestingPoolAddress;
  if (!pool) {
    return { pool: null, vestings: [], summary: emptySummary() };
  }

  const account = normalizeHex(address);
  if (!account) {
    // Anonymous read with no wallet header: nothing to look up.
    return { pool, vestings: [], summary: emptySummary() };
  }

  const rows = await fetchVestingRows(accessToken, pool, account);
  const vestings = rows
    .map(parseVestingRow)
    .filter((parsed) => parsed.account === account)
    .map((parsed) => computeVestingView(parsed, nowSeconds))
    .sort((a, b) => b.startDate - a.startDate || a.vestingId.localeCompare(b.vestingId));

  return { pool, vestings, summary: summarise(vestings) };
};

// ---- transactions ----

// Claims everything currently available on one vesting as the request's identity
// (vault key or external wallet; the contract pays only msg.sender == vesting.account).
// Status and claimable are deliberately not checked here so a claim on a not-started
// vesting surfaces the contract's own "Vesting not active yet".
export const claimVesting = async (
  accessToken: string,
  userAddress: string,
  vestingId: string
): Promise<{ status: string; hash: string }> => {
  const id = normalizeHex(vestingId);
  if (!/^[0-9a-f]{64}$/.test(id)) {
    throw new StratoError("Invalid vestingId", 400);
  }
  if (!vestingPoolAddress) {
    throw new StratoError("Vesting is not configured", 503);
  }

  const account = normalizeHex(userAddress);
  const { vestings } = await getVestingsForAddress(accessToken, account);
  if (!vestings.some((vesting) => vesting.vestingId === id)) {
    throw new StratoError("Vesting not found for this address", 403);
  }

  // bytes32 goes in as 64 hex without 0x (the AdminRegistry _issueId precedent),
  // the beneficiary as 40 hex without 0x.
  const builtTx = await buildFunctionTx({
    contractName: extractContractName(constants.VestingPool),
    contractAddress: vestingPoolAddress,
    method: "claimVestedTokens",
    args: { vestingId: id, beneficiary: account, tokensToClaim: MAX_UINT128 },
  }, account, accessToken);

  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
