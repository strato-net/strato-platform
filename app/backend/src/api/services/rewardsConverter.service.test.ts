import assert from "node:assert/strict";
import test, { TestContext } from "node:test";
import axios from "axios";
// Before the API helper: constants read their fixed addresses from config as it loads
import { constants } from "../../config/constants";
import * as config from "../../config/config";
import { bloc, cirrus, strato } from "../../utils/appApiHelper";
import { requestContext } from "../../utils/requestContext";
import {
  convert,
  convertInputs,
  dailyVolume,
  fundConverterReserve,
  getConverterAccount,
  getConverterAdminStats,
  getConverterDailyVolume,
  getConverterHistory,
  getIssueExecutionHash,
  getConverterState,
  maxConvertible,
  monthlyVolume,
  pauseConverter,
  setConverterRate,
  withdrawConverterReserve,
} from "./rewardsConverter.service";

const HELIUM = "114784819836269";
const CONVERTER = config.defaultRewardsConverterFor[HELIUM];
const REWARDS_TOKEN = "1111111111111111111111111111111111111111";
const STRATO_TOKEN = "2222222222222222222222222222222222222222";
const USER = "3333333333333333333333333333333333333333";
const E18 = 10n ** 18n;

type CirrusCall = { path: string; params: Record<string, any> };

/** Answers Cirrus by table; anything not listed is a balance large enough to pay fees. */
const mockCirrus = (t: TestContext, tables: Record<string, any[]>) => {
  const calls: CirrusCall[] = [];
  t.mock.method(cirrus, "get", (async (_token: string, path: string, requestConfig: any) => {
    calls.push({ path, params: requestConfig?.params ?? {} });
    const table = path.slice(1);
    return { status: 200, data: tables[table] ?? [{ value: (1000000n * E18).toString() }] };
  }) as typeof cirrus.get);
  return calls;
};

const converterRow = { rate: E18.toString(), _paused: false, rewardsToken: REWARDS_TOKEN, stratoToken: STRATO_TOKEN };
const tokenRows = [
  { address: REWARDS_TOKEN, _symbol: "RWD", customDecimals: 18, _totalSupply: (1000n * E18).toString() },
  { address: STRATO_TOKEN, _symbol: "STRATO", customDecimals: 18, _totalSupply: (5000n * E18).toString() },
];

/** The fee router lookup goes straight to the node: answer it as a network still charging USDST. */
const mockFeeRouter = (t: TestContext) =>
  t.mock.method(axios, "post", (async () => ({
    data: { error: { message: "no function for selector" } },
  })) as unknown as typeof axios.post);

const mockDetails = (t: TestContext) =>
  t.mock.method(bloc, "get", (async (_token: string, path: string) => ({
    status: 200,
    data: {
      _contractName: "Proxy",
      _functions: {
        setRate: { _funcArgs: [["newRate", { index: 0, type: { tag: "Int", signed: false, bytes: 32 } }]] },
        pause: { _funcArgs: [] },
        withdrawReserve: {
          _funcArgs: [
            ["amount", { index: 1, type: { tag: "Int", signed: false, bytes: 32 } }],
            ["to", { index: 0, type: { tag: "Address" } }],
          ],
        },
      },
    },
  })) as typeof bloc.get);

/** Captures the submitted transactions and answers with the given castVoteOnIssue return. */
const mockSubmit = (t: TestContext, contents?: unknown[]) => {
  const bodies: any[] = [];
  t.mock.method(strato, "post", (async (_token: string, path: string, body: any) => {
    assert.equal(path, "/transaction/parallel?resolve=true");
    bodies.push(body);
    if (requestContext.getStore()?.externalSigning) {
      return { status: 200, data: body.txs.map(() => ({ hash: "0xunsigned", data: { nonce: 7 } })) };
    }
    return {
      status: 200,
      data: body.txs.map(() => ({
        status: "Success",
        hash: "0xhash",
        ...(contents ? { data: { tag: "Call", contents } } : {}),
      })),
    };
  }) as typeof strato.post);
  return bodies;
};

test.beforeEach(() => config.setRewardsConverterConfig(HELIUM));

// ── Pure logic ────────────────────────────────────────────────────────────────

test("maxConvertible mirrors the contract: reserve × 1e18 ÷ rate, rounded down", () => {
  assert.equal(maxConvertible(1000n * E18, E18), 1000n * E18);
  // Helium test run, step 3.2
  assert.equal(maxConvertible(996n * E18, 333333333333333333n), 2988000000000000002988n);
  assert.equal(maxConvertible(495666666666666666667n, E18), 495666666666666666667n);
  assert.equal(maxConvertible(0n, E18), 0n);
  assert.equal(maxConvertible(1000n * E18, 0n), 0n);
});

test("convertInputs approves the exact amount, then converts it", () => {
  assert.deepEqual(convertInputs(CONVERTER, REWARDS_TOKEN, "4000000000000000000"), [
    {
      contractName: "Token",
      contractAddress: REWARDS_TOKEN,
      method: "approve",
      args: { spender: CONVERTER, value: "4000000000000000000" },
    },
    {
      contractName: "RewardsConverter",
      contractAddress: CONVERTER,
      method: "convert",
      args: { amount: "4000000000000000000" },
    },
  ]);
});

test("dailyVolume lists every day of the month up to today, oldest first", () => {
  const rows = [
    { day: "2026-11-19", paid: "5333333333333333333", burned: "6000000000000000001", n: 3 },
    { day: "2026-11-02", paid: "7", burned: "9", n: 1 },
  ];
  const november = dailyVolume("2026-11", rows, "2026-11-20");
  assert.equal(november.length, 20);
  assert.deepEqual(november[0], { period: "2026-11-01", paid: "0", burned: "0", count: 0 });
  assert.deepEqual(november[1], { period: "2026-11-02", paid: "7", burned: "9", count: 1 });
  assert.deepEqual(november[18], {
    period: "2026-11-19",
    paid: "5333333333333333333",
    burned: "6000000000000000001",
    count: 3,
  });
  assert.equal(november[19].period, "2026-11-20");

  assert.equal(dailyVolume("2026-10", [], "2026-11-20").length, 31);
  assert.equal(dailyVolume("2028-02", [], "2028-03-01").length, 29);
  assert.deepEqual(dailyVolume("2026-12", [], "2026-11-20"), []);
});

test("monthlyVolume folds days into months from the first conversion to today", () => {
  const rows = [
    { day: "2027-01-03", paid: "10", burned: "20", n: 2 },
    { day: "2026-11-19", paid: "900000000000000000000", burned: "1", n: 1 },
    { day: "2026-11-30", paid: "100000000000000000000", burned: "2", n: 4 },
  ];
  assert.deepEqual(monthlyVolume(rows, "2027-02-14"), [
    { period: "2026-11", paid: "1000000000000000000000", burned: "3", count: 5 },
    { period: "2026-12", paid: "0", burned: "0", count: 0 },
    { period: "2027-01", paid: "10", burned: "20", count: 2 },
    { period: "2027-02", paid: "0", burned: "0", count: 0 },
  ]);
  assert.deepEqual(monthlyVolume([], "2027-02-14"), []);
});

// ── Reads ─────────────────────────────────────────────────────────────────────

test("a network without a converter reports not configured without querying", async (t) => {
  config.setRewardsConverterConfig("33056204878082667");
  const calls = mockCirrus(t, {});
  assert.equal(constants.rewardsConverter, "");
  assert.deepEqual(await getConverterState("access-token"), { configured: false });
  assert.equal(calls.length, 0);
});

test("state reads the tokens from chain and derives max convertible from the reserve", async (t) => {
  const calls = mockCirrus(t, {
    "BlockApps-RewardsConverter": [{ ...converterRow, rate: "333333333333333333" }],
    "BlockApps-Token": tokenRows,
    "BlockApps-Token-_balances": [{ value: (996n * E18).toString() }],
  });

  assert.deepEqual(await getConverterState("access-token"), {
    configured: true,
    address: CONVERTER,
    rewardsToken: { address: REWARDS_TOKEN, symbol: "RWD", decimals: 18 },
    stratoToken: { address: STRATO_TOKEN, symbol: "STRATO", decimals: 18 },
    rate: "333333333333333333",
    paused: false,
    reserve: "996000000000000000000",
    maxConvertible: "2988000000000000002988",
  });
  assert.deepEqual(calls[0].params, {
    address: `eq.${CONVERTER}`,
    select: "rate::text,_paused,rewardsToken,stratoToken",
  });
  const reserveRead = calls.find((call) => call.path === "/BlockApps-Token-_balances");
  assert.deepEqual(reserveRead?.params, {
    address: `eq.${STRATO_TOKEN}`,
    key: `eq.${CONVERTER}`,
    select: "value::text",
  });
});

test("an empty reserve has no balance row and reads as zero", async (t) => {
  mockCirrus(t, {
    "BlockApps-RewardsConverter": [converterRow],
    "BlockApps-Token": tokenRows,
    "BlockApps-Token-_balances": [],
  });
  const state = await getConverterState("access-token");
  assert.ok(state.configured);
  assert.equal(state.reserve, "0");
  assert.equal(state.maxConvertible, "0");
});

test("account view resolves the balance through the converter's rewards token", async (t) => {
  const calls = mockCirrus(t, {
    "BlockApps-RewardsConverter": [{ rewardsToken: REWARDS_TOKEN }],
    "BlockApps-Token-_balances": [{ value: "4002827208295469080" }],
    "BlockApps-RewardsConverter-Converted": [
      { burned: "6000000000000000001", paid: "5333333333333333333", n: 3 },
    ],
  });

  assert.deepEqual(await getConverterAccount("access-token", `0x${USER.toUpperCase()}`), {
    balance: "4002827208295469080",
    totalConverted: "6000000000000000001",
    totalReceived: "5333333333333333333",
    conversionCount: 3,
  });
  assert.deepEqual(calls.find((call) => call.path === "/BlockApps-Token-_balances")?.params, {
    address: `eq.${REWARDS_TOKEN}`,
    key: `eq.${USER}`,
    select: "value::text",
  });
  assert.deepEqual(calls.find((call) => call.path === "/BlockApps-RewardsConverter-Converted")?.params, {
    address: `eq.${CONVERTER}`,
    user: `eq.${USER}`,
    select: "burned:rewardsAmount.sum()::text,paid:stratoAmount.sum()::text,n:count()",
  });
});

test("an account that never converted has zero totals", async (t) => {
  mockCirrus(t, {
    "BlockApps-RewardsConverter": [{ rewardsToken: REWARDS_TOKEN }],
    "BlockApps-Token-_balances": [],
    "BlockApps-RewardsConverter-Converted": [{ burned: null, paid: null, n: 0 }],
  });
  assert.deepEqual(await getConverterAccount("access-token", USER), {
    balance: "0",
    totalConverted: "0",
    totalReceived: "0",
    conversionCount: 0,
  });
});

test("history pages one account's conversions, newest first, with a total", async (t) => {
  const calls: CirrusCall[] = [];
  t.mock.method(cirrus, "get", (async (_token: string, path: string, requestConfig: any) => {
    calls.push({ path, params: requestConfig.params });
    if (requestConfig.params.select === "count()") return { status: 200, data: [{ count: 13 }] };
    return {
      status: 200,
      data: [
        {
          rewardsAmount: "1000000000000000001",
          stratoAmount: "333333333333333333",
          rate: "333333333333333333",
          block_timestamp: "2026-11-19 22:45:20 UTC",
          transaction_hash: "f2d5",
        },
      ],
    };
  }) as typeof cirrus.get);

  assert.deepEqual(await getConverterHistory("access-token", USER, 2, 10), {
    data: [
      {
        timestamp: "2026-11-19T22:45:20.000Z",
        converted: "1000000000000000001",
        received: "333333333333333333",
        rate: "333333333333333333",
        transactionHash: "f2d5",
      },
    ],
    totalCount: 13,
  });
  assert.deepEqual(calls.find((call) => call.params.select !== "count()")?.params, {
    address: `eq.${CONVERTER}`,
    user: `eq.${USER}`,
    select: "rewardsAmount::text,stratoAmount::text,rate::text,block_timestamp,transaction_hash",
    order: "block_timestamp.desc,id.desc",
    limit: "10",
    offset: "10",
  });
  assert.deepEqual(calls.find((call) => call.params.select === "count()")?.params, {
    address: `eq.${CONVERTER}`,
    user: `eq.${USER}`,
    select: "count()",
  });
});

test("issue execution is the first one from the vote on, or null before it executes", async (t) => {
  const calls = mockCirrus(t, {
    "BlockApps-AdminRegistry-IssueCreated": [],
    "BlockApps-AdminRegistry-IssueVoted": [{ issueId: "issue-1", block_timestamp: "2026-11-20 02:15:04 UTC" }],
    "BlockApps-AdminRegistry-IssueExecuted": [{ transaction_hash: "executing-tx" }],
  });

  assert.equal(await getIssueExecutionHash("access-token", "vote-tx"), "executing-tx");
  assert.deepEqual(calls.find((call) => call.path.endsWith("-IssueExecuted"))?.params, {
    issueId: "eq.issue-1",
    block_timestamp: "gte.2026-11-20 02:15:04 UTC",
    select: "transaction_hash",
    order: "block_timestamp.asc",
    limit: "1",
  });

  mockCirrus(t, {
    "BlockApps-AdminRegistry-IssueCreated": [],
    "BlockApps-AdminRegistry-IssueVoted": [{ issueId: "issue-1", block_timestamp: "2026-11-20 02:15:04 UTC" }],
    "BlockApps-AdminRegistry-IssueExecuted": [],
  });
  assert.equal(await getIssueExecutionHash("access-token", "vote-tx"), null);
});

test("admin stats derive total funded from the reserve", async (t) => {
  mockCirrus(t, {
    "BlockApps-RewardsConverter": [{ ...converterRow, rate: (E18 / 2n).toString() }],
    "BlockApps-Token": tokenRows,
    "BlockApps-Token-_balances": [{ value: (200n * E18).toString() }],
    "BlockApps-RewardsConverter-Converted": [
      { burned: "6000000000000000001", paid: "5333333333333333333", n: 3 },
    ],
    "BlockApps-RewardsConverter-ReserveWithdrawn": [{ withdrawn: "994666666666666666667" }],
  });

  assert.deepEqual(await getConverterAdminStats("access-token"), {
    totalBurned: "6000000000000000001",
    totalPaid: "5333333333333333333",
    conversionCount: 3,
    outstandingSupply: (1000n * E18).toString(),
    totalFunded: "205333333333333333333",
    totalWithdrawn: "994666666666666666667",
  });
});

test("daily volume asks Cirrus for one month grouped by day", async (t) => {
  const calls = mockCirrus(t, {
    "BlockApps-RewardsConverter-Converted": [{ day: "2026-01-19", paid: "5", burned: "6", n: 3 }],
  });

  const january = await getConverterDailyVolume("access-token", "2026-01");
  assert.equal(january.length, 31);
  assert.deepEqual(january[18], { period: "2026-01-19", paid: "5", burned: "6", count: 3 });
  assert.deepEqual(calls[0].params, {
    address: `eq.${CONVERTER}`,
    block_timestamp: ["gte.2026-01-01", "lt.2026-02-01"],
    select: "day:block_timestamp::date,paid:stratoAmount.sum()::text,burned:rewardsAmount.sum()::text,n:count()",
  });

  await getConverterDailyVolume("access-token", "2025-12");
  assert.deepEqual(calls[1].params.block_timestamp, ["gte.2025-12-01", "lt.2026-01-01"]);
});

// ── Writes ────────────────────────────────────────────────────────────────────

test("convert submits approve and convert as one transaction batch", async (t) => {
  mockFeeRouter(t);
  mockCirrus(t, { "BlockApps-RewardsConverter": [{ rewardsToken: REWARDS_TOKEN }] });
  const bodies = mockSubmit(t);

  const result = await convert("access-token", USER, "4000000000000000000");

  assert.equal(result.status, "Success");
  assert.equal(result.hash, "0xhash");
  assert.deepEqual(
    bodies[0].txs.map((tx: any) => tx.payload),
    convertInputs(CONVERTER, REWARDS_TOKEN, "4000000000000000000"),
  );
});

test("a governed call that only records a vote reports its issue id", async (t) => {
  mockFeeRouter(t);
  mockDetails(t);
  const calls = mockCirrus(t, { "BlockApps-AdminRegistry-IssueCreated": [{ issueId: "issue-1" }] });
  const bodies = mockSubmit(t, [false, "issue-1"]);

  const result = await setConverterRate("access-token", USER, "333333333333333333");

  assert.deepEqual(result, { status: "Success", hash: "0xhash", issueId: "issue-1", executed: false });
  assert.deepEqual(JSON.parse(JSON.stringify(bodies[0].txs[0].payload)), {
    contractName: "AdminRegistry",
    contractAddress: "000000000000000000000000000000000000100c",
    method: "castVoteOnIssue",
    args: {
      _func: "setRate",
      _target: CONVERTER,
      _args: [{ type: "uint256", value: "333333333333333333" }],
    },
  });
  assert.equal(
    calls.find((call) => call.path === "/BlockApps-AdminRegistry-IssueCreated")?.params.transaction_hash,
    "eq.0xhash",
  );
});

test("a governed call that executed reports so without looking for an issue", async (t) => {
  mockFeeRouter(t);
  mockDetails(t);
  const calls = mockCirrus(t, {});
  const bodies = mockSubmit(t, [true, "0"]);

  const result = await pauseConverter("access-token", USER);

  assert.deepEqual(result, { status: "Success", hash: "0xhash", issueId: null, executed: true });
  assert.deepEqual(bodies[0].txs[0].payload.args, { _func: "pause", _target: CONVERTER, _args: [] });
  assert.equal(calls.filter((call) => call.path.includes("AdminRegistry")).length, 0);
});

test("a governed call signed in a wallet answers before anything is known", async (t) => {
  mockFeeRouter(t);
  mockDetails(t);
  const calls = mockCirrus(t, {});
  mockSubmit(t);

  const result = await requestContext.run({ externalSigning: true, userAddress: USER }, () =>
    withdrawConverterReserve("access-token", USER, `0x${USER}`, "500000000000000000000"),
  );

  assert.deepEqual(result, { status: "unsigned", hash: "0xunsigned", issueId: null, executed: false });
  assert.equal(calls.filter((call) => call.path.includes("AdminRegistry")).length, 0);
});

test("withdrawReserve votes with the recipient and amount in declared order", async (t) => {
  mockFeeRouter(t);
  mockDetails(t);
  mockCirrus(t, { "BlockApps-AdminRegistry-IssueCreated": [{ issueId: "issue-2" }] });
  const bodies = mockSubmit(t, [false, "issue-2"]);

  await withdrawConverterReserve("access-token", USER, USER, "500000000000000000000");

  assert.deepEqual(JSON.parse(JSON.stringify(bodies[0].txs[0].payload.args)), {
    _func: "withdrawReserve",
    _target: CONVERTER,
    _args: [
      { type: "address", value: `0x${USER}` },
      { type: "uint256", value: "500000000000000000000" },
    ],
  });
});

test("funding transfers the caller's STRATO to the converter, with no vote and no mint", async (t) => {
  mockFeeRouter(t);
  const calls = mockCirrus(t, { "BlockApps-RewardsConverter": [{ stratoToken: STRATO_TOKEN }] });
  const bodies = mockSubmit(t);

  const result = await fundConverterReserve("access-token", USER, "1000000000000000000000");

  assert.equal(result.status, "Success");
  assert.equal(result.hash, "0xhash");
  assert.deepEqual(bodies[0].txs.map((tx: any) => tx.payload), [
    {
      contractName: "Token",
      contractAddress: STRATO_TOKEN,
      method: "transfer",
      args: { to: CONVERTER, value: "1000000000000000000000" },
    },
  ]);
  assert.equal(calls.filter((call) => call.path.includes("AdminRegistry")).length, 0);
});
