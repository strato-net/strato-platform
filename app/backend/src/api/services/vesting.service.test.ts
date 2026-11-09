import assert from "node:assert/strict";
import test from "node:test";
import { cirrus, strato } from "../../utils/appApiHelper";
import * as txBuilder from "../../utils/txBuilder";
import * as config from "../../config/config";
import { StratoError } from "../../errors";
import {
  ParsedVesting,
  WEEK_SECONDS,
  claimVesting,
  computeVestingView,
  getVestingsForAddress,
  parseVestingRow,
  summarise,
} from "./vesting.service";

const DAY = 86400;
const TWO_WEEKS = 2 * WEEK_SECONDS; // 1209600
const START = 1_700_000_000;
const ONE_TOKEN_PLUS_ONE = 1000000000000000000001n;
const ONE_THOUSAND_TOKENS = 1000000000000000000000n;

const POOL = "1a5ca5bcde1cf38ae2909f04fdb5c3b1f6998a37";
const TEAM_ACCOUNT = "26cf4d7d3241b5b227c3362d9c29ac15f22032ae";
const TEAM_ID = "1e90a6e8a999b210039e31684958620a5742e0a3ef8841a63ae96a5834144371";
const ZERO40 = "0000000000000000000000000000000000000000";

// Exact row shapes returned by helium's BlockApps-VestingPool-vestings table.
const heliumRows = [
  {
    key: TEAM_ID,
    value: {
      amount: "2500500000000000000000", account: TEAM_ACCOUNT, managed: true, cancelled: false,
      curveType: ZERO40, startDate: "1793836800", pausingDate: ZERO40, amountClaimed: ZERO40, durationWeeks: "2",
    },
  },
  {
    key: "2531dcdadc9dcf2c2e6c8aee2f4cbc56835760fa943b7b32831c698e1129a584",
    value: {
      amount: "10000000000000000000000", account: "1b5e295800f175a1f468d2f56af76a4985222e9e", managed: false, cancelled: false,
      curveType: ZERO40, startDate: "1793815200", pausingDate: ZERO40, amountClaimed: "200677910052910052910", durationWeeks: "1",
    },
  },
  {
    key: "4633656543ac99be4fca8b35da1b889932019630fbe8949a66ae958ff5b8cffe",
    value: {
      amount: "2710000000000000000000", account: "da9b6480b1cfe306b79e9fc9409666e1d233a964", managed: false, cancelled: false,
      curveType: ZERO40, startDate: "1793815200", pausingDate: ZERO40, amountClaimed: "2710000000000000000000", durationWeeks: ZERO40,
    },
  },
  {
    key: "50056542149a3c5dd91db8d25b5f9e9d147e2d0fc5b59d1e2b46cf4ebf589177",
    value: {
      amount: "229999000000000000000000", account: "5201f735a84adb64404c981903391aed2d1d47ac", managed: true, cancelled: true,
      curveType: ZERO40, startDate: "1793836800", pausingDate: "1793915888", amountClaimed: "15038162129629629629629", durationWeeks: "2",
    },
  },
  {
    key: "6e06a2136ba1c2b8e1ebccc6bbcca093db3d14cf63b02b2d520520f706c43892",
    value: {
      amount: "334000000000000000000000", account: "40153b4bc0a02808dc127f38e6033c76256f097d", managed: false, cancelled: false,
      curveType: ZERO40, startDate: "1793815200", pausingDate: ZERO40, amountClaimed: ZERO40, durationWeeks: ZERO40,
    },
  },
];

const parsed = (overrides: Partial<ParsedVesting> = {}): ParsedVesting => ({
  vestingId: "ab".repeat(32),
  account: TEAM_ACCOUNT,
  curveType: 0,
  managed: true,
  durationWeeks: 2,
  startDate: START,
  amount: ONE_TOKEN_PLUS_ONE,
  amountClaimed: 0n,
  pausingDate: 0,
  cancelled: false,
  ...overrides,
});

const withPool = (t: any, pool: string) => {
  const previous = config.vestingPoolAddress;
  (config as any).vestingPoolAddress = pool;
  t.after(() => {
    (config as any).vestingPoolAddress = previous;
  });
};

// ---- computeVestingView ----

test("before start nothing is vested and status is not_started", () => {
  const view = computeVestingView(parsed(), START - 1);
  assert.equal(view.vested, "0");
  assert.equal(view.claimable, "0");
  assert.equal(view.locked, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(view.status, "not_started");
  assert.equal(view.durationSeconds, TWO_WEEKS);
  assert.equal(view.endDate, START + TWO_WEEKS);
});

test("mid-vesting linear accrual floors like the contract", () => {
  // amount * 86400 / 1209600 == amount / 14; 14 * 71428571428571428571 = ...994, remainder 7
  const view = computeVestingView(parsed(), START + DAY);
  assert.equal(view.vested, "71428571428571428571");
  assert.equal(view.claimable, "71428571428571428571");
  assert.equal(view.locked, "928571428571428571430");
  // floor(1000000000000000000001 / 1209600)
  assert.equal(view.ratePerSecond, "826719576719576");
  assert.equal(view.ratePerSecond, (ONE_TOKEN_PLUS_ONE / BigInt(TWO_WEEKS)).toString());
  assert.equal(view.status, "vesting");
});

test("exact end vests everything and reports fully_vested", () => {
  const justBefore = computeVestingView(parsed(), START + TWO_WEEKS - 1);
  assert.equal(justBefore.status, "vesting");
  assert.ok(BigInt(justBefore.vested) < ONE_TOKEN_PLUS_ONE);

  const atEnd = computeVestingView(parsed(), START + TWO_WEEKS);
  assert.equal(atEnd.vested, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(atEnd.claimable, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(atEnd.locked, "0");
  assert.equal(atEnd.status, "fully_vested");

  const later = computeVestingView(parsed(), START + 10 * TWO_WEEKS);
  assert.equal(later.vested, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(later.status, "fully_vested");
});

test("zero-week vesting is fully vested at startDate and not before", () => {
  const before = computeVestingView(parsed({ durationWeeks: 0 }), START - 1);
  assert.equal(before.vested, "0");
  assert.equal(before.status, "not_started");

  const at = computeVestingView(parsed({ durationWeeks: 0 }), START);
  assert.equal(at.vested, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(at.status, "fully_vested");
  assert.equal(at.durationSeconds, 0);
  assert.equal(at.endDate, START);
  assert.equal(at.ratePerSecond, "0");
});

test("paused vesting is frozen at pausingDate as now advances", () => {
  const paused = parsed({ amount: ONE_THOUSAND_TOKENS, pausingDate: START + DAY });
  const expected = (ONE_THOUSAND_TOKENS / 14n).toString(); // 71428571428571428571

  const early = computeVestingView(paused, START + 10 * DAY);
  assert.equal(early.vested, expected);
  assert.equal(early.status, "paused");
  assert.equal(early.pausingDate, START + DAY);
  assert.equal(early.endDate, START + TWO_WEEKS);

  const late = computeVestingView(paused, START + 100 * DAY);
  assert.equal(late.vested, expected);
  assert.equal(late.claimable, expected);
  assert.equal(late.status, "paused");
});

test("pause before the start still reads not_started, pause after the end still reads fully_vested", () => {
  // A pre-start pause sets pausingDate = startDate; the countdown applies until then.
  const preStart = computeVestingView(parsed({ pausingDate: START }), START - DAY);
  assert.equal(preStart.vested, "0");
  assert.equal(preStart.status, "not_started");
  assert.equal(preStart.pausingDate, START);

  // A pause after the full duration freezes nothing: everything is already vested.
  const postEnd = computeVestingView(parsed({ pausingDate: START + TWO_WEEKS + DAY }), START + TWO_WEEKS + 2 * DAY);
  assert.equal(postEnd.vested, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(postEnd.status, "fully_vested");
});

test("cancelled vesting keeps the frozen vested part claimable, complete once claimed", () => {
  // Helium row 5005...: elapsed 79088 s of 2 weeks; 229999e18 * 79088 / 1209600 floors to
  // 15038162129629629629629, which is exactly what that account already claimed.
  const row = parseVestingRow(heliumRows[3]);
  const now = 1793915888 + 365 * DAY;

  const complete = computeVestingView(row, now);
  assert.equal(complete.vested, "15038162129629629629629");
  assert.equal(complete.claimable, "0");
  assert.equal(complete.status, "complete");
  assert.equal(complete.cancelled, true);
  // The unvested remainder went back to the pool: not locked for the beneficiary.
  assert.equal(complete.locked, "0");
  assert.equal(complete.returned, "214960837870370370370371");

  const unclaimed = computeVestingView({ ...row, amountClaimed: 1000000000000000000n }, now);
  assert.equal(unclaimed.vested, "15038162129629629629629");
  assert.equal(unclaimed.claimable, "15037162129629629629629");
  assert.equal(unclaimed.status, "cancelled");
  // Frozen: a later now does not change the figures.
  const muchLater = computeVestingView({ ...row, amountClaimed: 1000000000000000000n }, now + 1000 * DAY);
  assert.equal(muchLater.vested, unclaimed.vested);
});

test("fully claimed non-cancelled vesting is complete with nothing claimable", () => {
  const view = computeVestingView(parsed({ durationWeeks: 0, amountClaimed: ONE_TOKEN_PLUS_ONE }), START + DAY);
  assert.equal(view.vested, ONE_TOKEN_PLUS_ONE.toString());
  assert.equal(view.claimable, "0");
  assert.equal(view.status, "complete");
});

test("exponential curve squares elapsed over duration with BigInt floor", () => {
  // 1e21 * 86400^2 / 1209600^2 == 1e21 / 196; 196 * 5102040816326530612 = ...952, remainder 48
  const view = computeVestingView(parsed({ curveType: 1, amount: ONE_THOUSAND_TOKENS }), START + DAY);
  assert.equal(view.vested, "5102040816326530612");
  assert.equal(view.curveType, 1);
  assert.equal(view.status, "vesting");

  const half = computeVestingView(parsed({ curveType: 1, amount: ONE_THOUSAND_TOKENS }), START + WEEK_SECONDS);
  assert.equal(half.vested, (ONE_THOUSAND_TOKENS / 4n).toString());
});

// ---- parseVestingRow ----

test("parseVestingRow normalises the helium row shape", () => {
  const row = parseVestingRow(heliumRows[0]);
  assert.deepEqual(row, {
    vestingId: TEAM_ID,
    account: TEAM_ACCOUNT,
    curveType: 0,
    managed: true,
    durationWeeks: 2,
    startDate: 1793836800,
    amount: 2500500000000000000000n,
    amountClaimed: 0n,
    pausingDate: 0,
    cancelled: false,
  });

  const zeroWeeks = parseVestingRow(heliumRows[4]);
  assert.equal(zeroWeeks.durationWeeks, 0);
  assert.equal(zeroWeeks.amount, 334000000000000000000000n);
});

test("parseVestingRow accepts a JSON-string value, string booleans, numbers and 0x prefixes", () => {
  // Amounts stay strings: a JSON number above 2^53 would already have lost precision upstream.
  const row = parseVestingRow({
    key: `0x${TEAM_ID.toUpperCase()}`,
    value: JSON.stringify({
      amount: "2500500000000000000000", account: `0x${TEAM_ACCOUNT.toUpperCase()}`, managed: "true", cancelled: "false",
      curveType: 1, startDate: 1793836800, pausingDate: "1793915888", amountClaimed: 0, durationWeeks: 2,
    }),
  });
  assert.equal(row.vestingId, TEAM_ID);
  assert.equal(row.account, TEAM_ACCOUNT);
  assert.equal(row.managed, true);
  assert.equal(row.cancelled, false);
  assert.equal(row.curveType, 1);
  assert.equal(row.pausingDate, 1793915888);
  assert.equal(row.amount, 2500500000000000000000n);
  assert.equal(row.amountClaimed, 0n);
  assert.equal(row.durationWeeks, 2);
});

// ---- summarise ----

test("summarise adds every column as BigInt", () => {
  const now = START + DAY;
  const views = [
    computeVestingView(parsed(), now),
    computeVestingView(parsed({ vestingId: "cd".repeat(32), durationWeeks: 0, amountClaimed: 1n }), now),
  ];
  const summary = summarise(views);
  assert.deepEqual(summary, {
    amount: (2n * ONE_TOKEN_PLUS_ONE).toString(),
    vested: (71428571428571428571n + ONE_TOKEN_PLUS_ONE).toString(),
    claimed: "1",
    claimable: (71428571428571428571n + ONE_TOKEN_PLUS_ONE - 1n).toString(),
    locked: "928571428571428571430",
    returned: "0",
  });
});

// ---- getVestingsForAddress ----

test("getVestingsForAddress returns pool null without touching Cirrus when unconfigured", async (t) => {
  withPool(t, "");
  t.mock.method(cirrus, "get", async () => {
    assert.fail("Cirrus must not be called when the pool is unconfigured");
  });

  const result = await getVestingsForAddress("token", TEAM_ACCOUNT);
  assert.deepEqual(result, {
    pool: null,
    vestings: [],
    summary: { amount: "0", vested: "0", claimed: "0", claimable: "0", locked: "0", returned: "0" },
  });
});

test("getVestingsForAddress filters by pool and account on the vestings table", async (t) => {
  withPool(t, POOL);
  const calls: any[] = [];
  t.mock.method(cirrus, "get", async (_token: string, path: string, request?: any) => {
    calls.push({ path, params: request?.params });
    assert.equal(path, "/BlockApps-VestingPool-vestings");
    assert.equal(request.params.address, `eq.${POOL}`);
    assert.equal(request.params["value->>account"], `eq.${TEAM_ACCOUNT}`);
    assert.equal(request.params.select, "key,value");
    assert.equal(request.params.limit, 5000);
    return { status: 200, data: [heliumRows[0]] };
  });

  const now = 1793836800 + DAY;
  const result = await getVestingsForAddress("token", `0x${TEAM_ACCOUNT.toUpperCase()}`, now);
  assert.equal(calls.length, 1);
  assert.equal(result.pool, POOL);
  assert.equal(result.vestings.length, 1);
  assert.equal(result.vestings[0].vestingId, TEAM_ID);
  assert.equal(result.vestings[0].account, TEAM_ACCOUNT);
  assert.equal(result.vestings[0].vested, "178607142857142857142"); // 2500.5e18 / 14 floored
  assert.equal(result.vestings[0].status, "vesting");
  assert.equal(result.summary.amount, "2500500000000000000000");
});

test("getVestingsForAddress falls back to pool rows when the JSON filter is rejected", async (t) => {
  withPool(t, POOL);
  t.mock.method(console, "warn", (() => undefined) as typeof console.warn);
  const calls: any[] = [];
  t.mock.method(cirrus, "get", async (_token: string, path: string, request?: any) => {
    calls.push(request?.params);
    assert.equal(path, "/BlockApps-VestingPool-vestings");
    if (request?.params?.["value->>account"] !== undefined) {
      const error: any = new Error("Request failed with status code 400");
      error.response = { status: 400, data: { message: "unexpected operator" } };
      throw error;
    }
    assert.equal(request.params.address, `eq.${POOL}`);
    assert.equal(request.params.limit, 5000);
    return { status: 200, data: heliumRows };
  });

  const now = 1793836800 + DAY;
  const result = await getVestingsForAddress("token", TEAM_ACCOUNT, now);
  assert.equal(calls.length, 2);
  assert.ok("value->>account" in calls[0]);
  assert.ok(!("value->>account" in calls[1]));
  assert.deepEqual(result.vestings.map((vesting) => vesting.vestingId), [TEAM_ID]);
  assert.deepEqual(result.summary, {
    amount: "2500500000000000000000",
    vested: "178607142857142857142",
    claimed: "0",
    claimable: "178607142857142857142",
    locked: "2321892857142857142858",
    returned: "0",
  });
});

test("getVestingsForAddress sorts newest startDate first", async (t) => {
  withPool(t, POOL);
  const older = { ...heliumRows[0], key: "11".repeat(32), value: { ...heliumRows[0].value, startDate: "1793000000" } };
  const newer = { ...heliumRows[0], key: "22".repeat(32), value: { ...heliumRows[0].value, startDate: "1794000000" } };
  t.mock.method(cirrus, "get", async () => ({ status: 200, data: [older, heliumRows[0], newer] }));

  const result = await getVestingsForAddress("token", TEAM_ACCOUNT, 1795000000);
  assert.deepEqual(result.vestings.map((vesting) => vesting.startDate), [1794000000, 1793836800, 1793000000]);
});

// ---- claimVesting ----

test("claimVesting rejects a malformed id before any lookup", async (t) => {
  withPool(t, POOL);
  t.mock.method(cirrus, "get", async () => {
    assert.fail("Cirrus must not be called for a malformed id");
  });

  await assert.rejects(claimVesting("token", TEAM_ACCOUNT, "0xnothex"), (error: any) => {
    assert.ok(error instanceof StratoError);
    assert.equal(error.status, 400);
    return true;
  });
});

test("claimVesting reports 503 when the pool is unconfigured", async (t) => {
  withPool(t, "");
  await assert.rejects(claimVesting("token", TEAM_ACCOUNT, TEAM_ID), (error: any) => {
    assert.ok(error instanceof StratoError);
    assert.equal(error.status, 503);
    assert.equal(error.message, "Vesting is not configured");
    return true;
  });
});

test("claimVesting refuses an id that belongs to another account without building a tx", async (t) => {
  withPool(t, POOL);
  t.mock.method(cirrus, "get", async () => ({ status: 200, data: heliumRows }));
  t.mock.method(txBuilder, "buildFunctionTx", async () => {
    assert.fail("buildFunctionTx must not be called for a foreign vesting id");
  });
  t.mock.method(strato, "post", async () => {
    assert.fail("strato.post must not be called for a foreign vesting id");
  });

  const foreignId = heliumRows[1].key;
  await assert.rejects(claimVesting("token", TEAM_ACCOUNT, `0x${foreignId}`), (error: any) => {
    assert.ok(error instanceof StratoError);
    assert.equal(error.status, 403);
    assert.equal(error.message, "Vesting not found for this address");
    return true;
  });
});

test("claimVesting builds claimVestedTokens for the caller's own vesting", async (t) => {
  withPool(t, POOL);
  t.mock.method(cirrus, "get", async () => ({ status: 200, data: heliumRows }));
  const built: any[] = [];
  t.mock.method(txBuilder, "buildFunctionTx", async (inputs: any, userAddress: string) => {
    built.push({ inputs, userAddress });
    return { txs: [], txParams: {} };
  });
  t.mock.method(strato, "post", async () => ({
    status: 200,
    data: [{ status: "Success", hash: "deadbeef" }],
  }));

  const result = await claimVesting("token", `0x${TEAM_ACCOUNT}`, `0x${TEAM_ID.toUpperCase()}`);
  assert.equal(result.status, "Success");
  assert.equal(result.hash, "deadbeef");
  assert.equal(built.length, 1);
  assert.equal(built[0].userAddress, TEAM_ACCOUNT);
  assert.deepEqual(built[0].inputs, {
    contractName: "VestingPool",
    contractAddress: POOL,
    method: "claimVestedTokens",
    args: {
      vestingId: TEAM_ID,
      beneficiary: TEAM_ACCOUNT,
      tokensToClaim: "340282366920938463463374607431768211455",
    },
  });
});
