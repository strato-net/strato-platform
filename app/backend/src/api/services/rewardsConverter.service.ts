import {
  GovernedCallResult,
  RewardsConverterAccount,
  RewardsConverterAdminStats,
  RewardsConverterHistory,
  RewardsConverterState,
  RewardsConverterToken,
  RewardsConverterVolumeBucket,
} from "@strato/shared-types";
import { strato, cirrus } from "../../utils/appApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { FunctionInput } from "../../types/types";
import { normalizeAddress } from "../helpers/earnRewards.helper";
import { safeBigInt } from "../helpers/safeBigInt.helper";
import { governedInput, findIssueIdForTx } from "./user.service";

const { RewardsConverter, Token, AdminRegistry, DECIMALS: WAD } = constants;
const Converted = `${RewardsConverter}-Converted`;

// ---- Pure logic ----

/** Mirrors RewardsConverter.maxConvertible. */
export const maxConvertible = (reserve: bigint, rate: bigint): bigint =>
  rate === 0n ? 0n : (reserve * WAD) / rate;

export const convertInputs = (
  converter: string,
  rewardsToken: string,
  amount: string
): FunctionInput[] => [
  {
    contractName: extractContractName(Token),
    contractAddress: rewardsToken,
    method: "approve",
    args: { spender: converter, value: amount },
  },
  {
    contractName: extractContractName(RewardsConverter),
    contractAddress: converter,
    method: "convert",
    args: { amount },
  },
];

interface VolumeRow {
  day: string;
  paid: string;
  burned: string;
  n: number;
}

/** One bucket per period, in the order given, each summing the rows that fall in it. */
const fillBuckets = (periods: string[], rows: VolumeRow[], periodOf: (day: string) => string) => {
  const buckets = new Map<string, RewardsConverterVolumeBucket>(
    periods.map((period) => [period, { period, paid: "0", burned: "0", count: 0 }])
  );
  for (const row of rows) {
    const bucket = buckets.get(periodOf(row.day));
    if (!bucket) continue;
    bucket.paid = (BigInt(bucket.paid) + safeBigInt(row.paid)).toString();
    bucket.burned = (BigInt(bucket.burned) + safeBigInt(row.burned)).toString();
    bucket.count += Number(row.n);
  }
  return [...buckets.values()];
};

/** Every UTC day of `month` ("YYYY-MM") up to `today` ("YYYY-MM-DD"), oldest first. */
export const dailyVolume = (
  month: string,
  rows: VolumeRow[],
  today: string
): RewardsConverterVolumeBucket[] => {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  return fillBuckets(days.filter((day) => day <= today), rows, (day) => day);
};

/** Every UTC month from the first conversion to `today`'s, oldest first; empty before any conversion. */
export const monthlyVolume = (rows: VolumeRow[], today: string): RewardsConverterVolumeBucket[] => {
  if (!rows.length) return [];
  const monthOf = (day: string) => day.slice(0, 7);
  const first = rows.map((row) => row.day).sort()[0];
  const months: string[] = [];
  const cursor = new Date(`${monthOf(first)}-01T00:00:00Z`);
  while (monthOf(cursor.toISOString()) <= monthOf(today)) {
    months.push(monthOf(cursor.toISOString()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return fillBuckets(months, rows, monthOf);
};

// ---- Reads ----

const balanceOf = async (accessToken: string, token: string, holder: string): Promise<bigint> => {
  const { data } = await cirrus.get(accessToken, `/${Token}-_balances`, {
    params: { address: `eq.${token}`, key: `eq.${holder}`, select: "value::text" },
  });
  return safeBigInt(data?.[0]?.value);
};

const readConverter = async (accessToken: string, address: string, select: string) => {
  const { data } = await cirrus.get(accessToken, `/${RewardsConverter}`, {
    params: { address: `eq.${address}`, select },
  });
  if (!data?.[0]) throw new Error(`RewardsConverter ${address} not found`);
  return data[0];
};

const loadConverter = async (accessToken: string, address: string) => {
  const converter = await readConverter(accessToken, address, "rate::text,_paused,rewardsToken,stratoToken");
  const [{ data: tokens }, reserve] = await Promise.all([
    cirrus.get(accessToken, `/${Token}`, {
      params: {
        address: `in.(${converter.rewardsToken},${converter.stratoToken})`,
        select: "address,_symbol,customDecimals,_totalSupply::text",
      },
    }),
    balanceOf(accessToken, converter.stratoToken, address),
  ]);
  const row = (tokenAddress: string) => (tokens || []).find((t: any) => t.address === tokenAddress);
  const token = (tokenAddress: string): RewardsConverterToken => ({
    address: tokenAddress,
    symbol: row(tokenAddress)?._symbol || "",
    decimals: Number(row(tokenAddress)?.customDecimals),
  });
  return {
    rate: safeBigInt(converter.rate),
    paused: converter._paused === true,
    rewardsToken: token(converter.rewardsToken),
    stratoToken: token(converter.stratoToken),
    outstandingSupply: safeBigInt(row(converter.rewardsToken)?._totalSupply),
    reserve,
  };
};

const convertedTotals = async (accessToken: string, address: string, user?: string) => {
  const { data } = await cirrus.get(accessToken, `/${Converted}`, {
    params: {
      address: `eq.${address}`,
      ...(user ? { user: `eq.${user}` } : {}),
      select: "burned:rewardsAmount.sum()::text,paid:stratoAmount.sum()::text,n:count()",
    },
  });
  return {
    burned: safeBigInt(data?.[0]?.burned),
    paid: safeBigInt(data?.[0]?.paid),
    count: Number(data?.[0]?.n || 0),
  };
};

const volumeRows = async (
  accessToken: string,
  address: string,
  range?: [string, string]
): Promise<VolumeRow[]> => {
  const { data } = await cirrus.get(accessToken, `/${Converted}`, {
    params: {
      address: `eq.${address}`,
      ...(range ? { block_timestamp: [`gte.${range[0]}`, `lt.${range[1]}`] } : {}),
      select: "day:block_timestamp::date,paid:stratoAmount.sum()::text,burned:rewardsAmount.sum()::text,n:count()",
    },
    paramsSerializer: { indexes: null },
  });
  return data || [];
};

const utcToday = (): string => new Date().toISOString().slice(0, 10);

export const getConverterState = async (accessToken: string): Promise<RewardsConverterState> => {
  const address = constants.rewardsConverter;
  if (!address) return { configured: false };
  const { rate, paused, reserve, rewardsToken, stratoToken } = await loadConverter(accessToken, address);
  return {
    configured: true,
    address,
    rewardsToken,
    stratoToken,
    rate: rate.toString(),
    paused,
    reserve: reserve.toString(),
    maxConvertible: maxConvertible(reserve, rate).toString(),
  };
};

export const getConverterAccount = async (
  accessToken: string,
  userAddress: string
): Promise<RewardsConverterAccount> => {
  const address = constants.rewardsConverter;
  const user = normalizeAddress(userAddress);
  const { rewardsToken } = await readConverter(accessToken, address, "rewardsToken");
  const [balance, totals] = await Promise.all([
    balanceOf(accessToken, rewardsToken, user),
    convertedTotals(accessToken, address, user),
  ]);
  return {
    balance: balance.toString(),
    totalConverted: totals.burned.toString(),
    totalReceived: totals.paid.toString(),
    conversionCount: totals.count,
  };
};

export const getConverterHistory = async (
  accessToken: string,
  userAddress: string,
  page: number,
  limit: number
): Promise<RewardsConverterHistory> => {
  const filters = {
    address: `eq.${constants.rewardsConverter}`,
    user: `eq.${normalizeAddress(userAddress)}`,
  };
  const [{ data: rows }, { data: count }] = await Promise.all([
    cirrus.get(accessToken, `/${Converted}`, {
      params: {
        ...filters,
        select: "rewardsAmount::text,stratoAmount::text,rate::text,block_timestamp,transaction_hash",
        order: "block_timestamp.desc,id.desc",
        limit: limit.toString(),
        offset: ((page - 1) * limit).toString(),
      },
    }),
    cirrus.get(accessToken, `/${Converted}`, { params: { ...filters, select: "count()" } }),
  ]);
  return {
    data: (rows || []).map((row: any) => ({
      timestamp: new Date(row.block_timestamp).toISOString(),
      converted: row.rewardsAmount,
      received: row.stratoAmount,
      rate: row.rate,
      transactionHash: row.transaction_hash,
    })),
    totalCount: count?.[0]?.count || 0,
  };
};

export const getConverterAdminStats = async (accessToken: string): Promise<RewardsConverterAdminStats> => {
  const address = constants.rewardsConverter;
  const [{ reserve, outstandingSupply }, totals, { data: withdrawals }] = await Promise.all([
    loadConverter(accessToken, address),
    convertedTotals(accessToken, address),
    cirrus.get(accessToken, `/${RewardsConverter}-ReserveWithdrawn`, {
      params: { address: `eq.${address}`, select: "withdrawn:amount.sum()::text" },
    }),
  ]);
  return {
    totalBurned: totals.burned.toString(),
    totalPaid: totals.paid.toString(),
    conversionCount: totals.count,
    outstandingSupply: outstandingSupply.toString(),
    totalFunded: (reserve + totals.paid).toString(),
    totalWithdrawn: safeBigInt(withdrawals?.[0]?.withdrawn).toString(),
  };
};

export const getConverterDailyVolume = async (
  accessToken: string,
  month: string
): Promise<RewardsConverterVolumeBucket[]> => {
  const [year, monthNumber] = month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const rows = await volumeRows(accessToken, constants.rewardsConverter, [`${month}-01`, `${nextMonth}-01`]);
  return dailyVolume(month, rows, utcToday());
};

export const getConverterMonthlyVolume = async (
  accessToken: string
): Promise<RewardsConverterVolumeBucket[]> =>
  monthlyVolume(await volumeRows(accessToken, constants.rewardsConverter), utcToday());

/** Hash of the transaction that executed the issue `voteHash` voted on, or null while it has not executed. */
export const getIssueExecutionHash = async (accessToken: string, voteHash: string): Promise<string | null> => {
  const firstRow = (event: string, params: Record<string, string>) =>
    cirrus
      .get(accessToken, `/${AdminRegistry}-${event}`, { params: { ...params, limit: "1" } })
      .then((res) => res.data?.[0]);
  const byVote = { transaction_hash: `eq.${voteHash}`, select: "issueId,block_timestamp" };
  const [created, voted] = await Promise.all([firstRow("IssueCreated", byVote), firstRow("IssueVoted", byVote)]);
  const vote = created ?? voted;
  if (!vote) return null;
  // The same call always gets the same issue id, so only an execution from this vote on counts.
  // block_timestamp is text: it compares correctly only against Cirrus's own format.
  const executed = await firstRow("IssueExecuted", {
    issueId: `eq.${vote.issueId}`,
    block_timestamp: `gte.${vote.block_timestamp}`,
    select: "transaction_hash",
    order: "block_timestamp.asc",
  });
  return executed?.transaction_hash ?? null;
};

// ---- Writes ----

export const convert = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const address = constants.rewardsConverter;
  const { rewardsToken } = await readConverter(accessToken, address, "rewardsToken");
  const builtTx = await buildFunctionTx(convertInputs(address, rewardsToken, amount), userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};

const governedCall = async (
  accessToken: string,
  userAddress: string,
  input: FunctionInput
): Promise<GovernedCallResult> => {
  const builtTx = await buildFunctionTx(await governedInput(accessToken, input), userAddress, accessToken);
  const { status, hash, returnValues } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
  // castVoteOnIssue returns (true, …) when the vote ran the call. A wallet signs after
  // this returns, so nothing is known yet
  const executed = returnValues?.[0]?.[0] === true;
  const issueId = status === "unsigned" || executed ? null : await findIssueIdForTx(accessToken, hash);
  return { status, hash, issueId, executed };
};

const converterCall = (method: string, args: Record<string, string> = {}): FunctionInput => ({
  contractName: extractContractName(RewardsConverter),
  contractAddress: constants.rewardsConverter,
  method,
  args,
});

export const setConverterRate = (accessToken: string, userAddress: string, rate: string) =>
  governedCall(accessToken, userAddress, converterCall("setRate", { newRate: rate }));

export const pauseConverter = (accessToken: string, userAddress: string) =>
  governedCall(accessToken, userAddress, converterCall("pause"));

export const unpauseConverter = (accessToken: string, userAddress: string) =>
  governedCall(accessToken, userAddress, converterCall("unpause"));

export const withdrawConverterReserve = (
  accessToken: string,
  userAddress: string,
  to: string,
  amount: string
) => governedCall(accessToken, userAddress, converterCall("withdrawReserve", { to, amount }));

/** Funding: the caller sends its own STRATO straight to the converter. */
export const fundConverterReserve = async (
  accessToken: string,
  userAddress: string,
  amount: string
): Promise<{ status: string; hash: string }> => {
  const address = constants.rewardsConverter;
  const { stratoToken } = await readConverter(accessToken, address, "stratoToken");
  const builtTx = await buildFunctionTx(
    {
      contractName: extractContractName(Token),
      contractAddress: stratoToken,
      method: "transfer",
      args: { to: address, value: amount },
    },
    userAddress,
    accessToken
  );
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
