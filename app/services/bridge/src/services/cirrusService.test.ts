import assert from "node:assert/strict";
import test from "node:test";

for (const name of [
  "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL",
  "BRIDGE_ADDRESS", "EXTERNAL_ASSET_BRIDGE_ADDRESS", "STRATO_NATIVE_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "SENDGRID_API_KEY", "STRATO_NODE_URL",
  "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_SECRET", "RELAYER_CLIENT_ID",
  "RELAYER_OPENID_DISCOVERY_URL", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION",
]) process.env[name] ||= "1".repeat(40);
process.env.SENDGRID_API_KEY = "SG.test.test";

const external = "/BlockApps-ExternalAssetBridge";
const native = "/BlockApps-StratoNativeBridge";
const legacy = "/BlockApps-MercataBridge";
const router = "a".repeat(40), token = "b".repeat(40), target = "c".repeat(40);
const id = (index: number) => (10n ** 76n + BigInt(index)).toString();
const withdrawal = (index: number) => ({ key: id(index), value: {
  externalChainId: "1", status: "1", bridgeStatus: "1", requestedAt: "100",
  externalToken: token, externalTokenAmount: "100", requiresManualReview: false,
} });
const deposit = (index: number) => ({ key: "1", key2: router, key3: id(index), value: {
  status: "1", bridgeStatus: "1", timestamp: "100", externalToken: token, stratoToken: target,
  externalTokenAmount: "100", externalTxHash: `hash-${index}`,
} });

async function mockCirrus(t: any, tables: Record<string, any[]>, cap = 3) {
  const { cirrus } = await import("../utils/api");
  const calls: Array<{ path: string; params: any }> = [];
  const data = {
    [`${external}-chains`]: [{ key: "1", value: { enabled: true, vault: target, depositRouter: router } }],
    [`${external}-depositRouters`]: [],
    [`${external}-routes`]: [{ key: token, key2: "1", key3: target, value: { externalDecimals: "18" } }],
    ...tables,
  };
  t.mock.method(cirrus, "get", async (url: string, { params }: any) => {
    assert.ok(calls.length < 2000, "pagination must terminate");
    const path = url.split("?")[0];
    calls.push({ path, params });
    // Include the encoded query, not just the raw IDs, when checking URL bounds.
    assert.ok(`${url}?${new URLSearchParams(params)}`.length < 8000);
    let rows = data[path] || [];
    for (const column of ["key", "key2", "key3", "withdrawalId"]) {
      const filter = params[column];
      if (filter?.startsWith("in.(")) {
        const ids = filter.slice(4, -1).split(",");
        assert.ok(ids.length <= 20);
        rows = rows.filter((row) => ids.includes(String(row[column])));
      } else if (filter?.startsWith("eq.")) {
        rows = rows.filter((row) => String(row[column]) === filter.slice(3));
      }
    }
    if (params.or) {
      const identities = [...params.or.matchAll(/and\(key2.eq.([^,]+),key3.eq.([^)]+)\)/g)] as RegExpMatchArray[];
      assert.ok(identities.length > 0 && identities.length <= 20);
      rows = rows.filter((row) => identities.some((match) => row.key2 === match[1] && String(row.key3) === match[2]));
    }
    for (const field of ["status", "bridgeStatus"]) {
      if (params[`value->>${field}`]) rows = rows.filter((row) => String(row.value[field]) === params[`value->>${field}`].slice(3));
    }
    if (params.offset != null) {
      assert.ok(params.order, "every page needs deterministic ordering");
      assert.ok(params.limit <= 200);
      return rows.slice(params.offset, params.offset + Math.min(cap, params.limit));
    }
    return rows;
  });
  return calls;
}

for (const [method, table, rows, identity] of [
  ["getWithdrawalsByStatus", `${legacy}-withdrawals`, Array.from({ length: 7 }, (_, i) => withdrawal(i)), "withdrawalId"],
  ["getExternalWithdrawalsByStatus", `${external}-withdrawals`, Array.from({ length: 7 }, (_, i) => withdrawal(i)), "withdrawalId"],
  ["getNativeWithdrawalsByStatus", `${native}-withdrawals`, Array.from({ length: 7 }, (_, i) => withdrawal(i)), "withdrawalId"],
  ["getDepositsByStatus", `${external}-deposits`, Array.from({ length: 7 }, (_, i) => deposit(i)), "depositId"],
  ["getNativeDepositsByStatus", `${native}-deposits`, Array.from({ length: 7 }, (_, i) => ({ key: id(i), value: deposit(i).value })), "depositId"],
] as const) {
  test(`${method} reads beyond a server row cap with tied timestamps`, async (t) => {
    const calls = await mockCirrus(t, { [table]: [...rows] });
    const service = await import("./cirrusService");
    const result = await service[method]("1");
    assert.deepEqual(result.map((row: any) => row[identity]), Array.from({ length: 7 }, (_, i) => id(i)));
    const pages = calls.filter((call) => call.path === table);
    assert.deepEqual(pages.map((call) => call.params.offset), [0, 3, 6, 7]);
    assert.match(pages[0].params.order, method === "getDepositsByStatus" ? /key.asc,key2.asc,key3.asc$/ : /key.asc$/);
  });
}

test("withdrawal enrichment batches long IDs and reads capped authorization/review pages", async (t) => {
  const rows = Array.from({ length: 45 }, (_, i) => withdrawal(i));
  await mockCirrus(t, {
    [`${external}-withdrawals`]: rows,
    [`${external}-withdrawalAuthorizations`]: rows.map((row) => ({ key: row.key, value: { notBefore: row.key, destinationVault: router } })),
    [`${external}-withdrawalManualReviews`]: rows.map((row) => ({ key: row.key, value: { reviewDigest: row.key } })),
  });
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const result = await getExternalWithdrawalsByStatus("1");
  assert.equal(result.length, rows.length);
  for (const row of result) {
    assert.equal(row.authorizationNotBefore, row.withdrawalId);
    assert.equal(row.reviewDigest, row.withdrawalId);
    assert.equal(row.vault, router);
  }
});

test("capacity-stalled withdrawals do not hide later withdrawals from a polling pass", async (t) => {
  await mockCirrus(t, { [`${external}-withdrawals`]: Array.from({ length: 7 }, (_, i) => withdrawal(i)) });
  const bridge = await import("./bridgeService");
  const { startExternalWithdrawalPolling } = await import("../polling/stratoPolling");
  const processed: string[] = [];
  t.mock.method(bridge, "processExternalWithdrawal", async (row: any) => {
    // Simulate the early return used when capacity is unavailable for the oldest rows.
    if (BigInt(row.withdrawalId) < BigInt(id(3))) return;
    processed.push(row.withdrawalId);
  });
  let completed!: () => void;
  const done = new Promise<void>((resolve) => { completed = resolve; });
  t.mock.method(global, "setTimeout", (() => { completed(); return 0; }) as any);
  startExternalWithdrawalPolling();
  await done;
  assert.deepEqual(processed, [3, 4, 5, 6].map(id));
});

test("recorded reviews and indexed settlements bound composite filters and survive row caps", async (t) => {
  const rows = Array.from({ length: 45 }, (_, i) => deposit(i));
  const calls = await mockCirrus(t, {
    [`${external}-deposits`]: rows.map((row) => ({ ...row, value: { ...row.value, status: "2" } })),
    [`${external}-depositActions`]: rows.map((row) => ({ ...row, value: { action: "4", actionToken: target, minFinalOut: row.key3 } })),
  });
  const service = await import("./cirrusService");
  const reviews = await service.getRecordedDepositReviews(1);
  assert.equal(reviews.length, rows.length);
  assert.ok(reviews.every((review) => review.action === "4" && review.minFinalOut === review.depositId));
  assert.ok(calls.filter((call) => call.path.endsWith("-depositActions") && call.params.offset === 0).length === 3);
  t.mock.restoreAll();
  await mockCirrus(t, { [`${external}-deposits`]: rows.map((row) => ({ ...row, value: { ...row.value, status: "4" } })) });
  const settled = await service.getIndexedDepositSettlements(1, rows.map((row) => ({ depositRouter: router, depositId: row.key3 })));
  assert.deepEqual(settled.map((row) => row.depositId), rows.map((row) => row.key3));
});

test("asset, rebase and Safe-event lookups batch and paginate their ID lists", async (t) => {
  const addresses = Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(40, "0"));
  const ids = addresses.map((_, i) => id(i));
  await mockCirrus(t, {
    [external]: [{ priceOracle: target }],
    [`${external}-routes`]: addresses.map((key) => ({ key, key2: "1", key3: target, value: { externalDecimals: "6" } })),
    "/BlockApps-PriceOracle-rebaseFactors": addresses.map((key) => ({ key, value: "100" })),
    [`${legacy}-WithdrawalPending`]: ids.map((withdrawalId) => ({ withdrawalId, custodyTxHash: withdrawalId })),
  });
  const service = await import("./cirrusService");
  assert.equal((await service.getAssetInfo(addresses as [string, ...string[]])).size, 45);
  assert.equal((await service.getRebaseFactors([...addresses, addresses[0]])).size, 45);
  assert.equal((await service.getExternalBridgeRebaseFactors(addresses)).size, 45);
  assert.deepEqual(await service.getSafeTxHashFromEvents(ids), Object.fromEntries(ids.map((key) => [key, key])));
});

test("pagination rejects malformed or failed later pages instead of returning partial work", async (t) => {
  const { cirrus } = await import("../utils/api");
  const { getNativeWithdrawalsByStatus } = await import("./cirrusService");
  for (const fail of [() => ({}), () => { throw new Error("offline"); }]) {
    t.mock.method(cirrus, "get", async (_url: string, { params }: any) => params.offset === 0 ? [withdrawal(0)] : fail());
    await assert.rejects(getNativeWithdrawalsByStatus("1"), /Invalid Cirrus response|offline/);
    t.mock.restoreAll();
  }
});
