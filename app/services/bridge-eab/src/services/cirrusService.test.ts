import assert from "node:assert/strict";
import test from "node:test";

for (const name of [
  "BA_USERNAME", "BA_PASSWORD", "CLIENT_SECRET", "CLIENT_ID", "OPENID_DISCOVERY_URL",
  "EXTERNAL_ASSET_BRIDGE_ADDRESS", "STRATO_NATIVE_BRIDGE_ADDRESS",
  "PRICE_ORACLE_ADDRESS", "SAFE_ADDRESS", "SAFE_PROPOSER_ADDRESS", "SENDGRID_API_KEY", "STRATO_NODE_URL",
  "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_SECRET", "RELAYER_CLIENT_ID",
  "RELAYER_OPENID_DISCOVERY_URL", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION",
]) process.env[name] ||= "1".repeat(40);
process.env.SENDGRID_API_KEY = "SG.test.test";

const external = "/BlockApps-ExternalAssetBridge";
const native = "/BlockApps-StratoNativeBridge";
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
    if (params["value->>enabled"] === "eq.true") rows = rows.filter(row => row.value.enabled === true);
    if (params["bridge.withdrawalsPaused"] === "eq.false") rows = rows.filter(row => row.bridge?.withdrawalsPaused !== true);
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
    if (params.or === "(and(value->>bridgeStatus.eq.2,value->>useInstantPath.eq.false),value->>bridgeStatus.eq.10)") {
      rows = rows.filter(row => String(row.value.bridgeStatus) === "10" || (String(row.value.bridgeStatus) === "2" && String(row.value.useInstantPath) === "false"));
    } else if (params.or) {
      const identities = [...params.or.matchAll(/and\(key2.eq.([^,]+),key3.eq.([^)]+)\)/g)] as RegExpMatchArray[];
      assert.ok(identities.length > 0 && identities.length <= 20);
      rows = rows.filter((row) => identities.some((match) => row.key2 === match[1] && String(row.key3) === match[2]));
    }
    for (const field of ["status", "bridgeStatus", "useInstantPath"]) {
      const filter = params[`value->>${field}`];
      if (filter?.startsWith("eq.")) rows = rows.filter((row) => String(row.value[field]) === filter.slice(3));
      if (filter?.startsWith("in.(")) rows = rows.filter((row) => filter.slice(4, -1).split(",").includes(String(row.value[field])));
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

test("email token metadata batches and paginates, retaining precision without guessing malformed decimals", async t => {
  const { cirrus } = await import("../utils/api");
  const { getBridgeEmailTokens } = await import("./cirrusService");
  const { EMAIL_METADATA_TIMEOUT_MS } = await import("../config");
  const addresses = Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(40, "a"));
  const decimals = [0, "6", 18, null, "NaN", "", -1, 256, "1.5"];
  const rows = addresses.map((address, i) => ({ address, _symbol: i === 9 ? "bad\nsymbol" : `TOKEN${i}`,
    customDecimals: i < decimals.length ? decimals[i] : 18 }));
  let calls = 0;
  t.mock.method(cirrus, "get", async (url: string, { params, timeout }: any) => {
    calls++;
    assert.ok(calls < 30);
    assert.equal(url, "/BlockApps-Token");
    assert.equal(timeout, EMAIL_METADATA_TIMEOUT_MS);
    assert.equal(params.select, "address,_symbol,customDecimals");
    assert.equal(params.order, "address.asc");
    const ids = params.address.slice(4, -1).split(",");
    assert.ok(ids.length <= 20);
    return rows.filter(row => ids.includes(row.address)).slice(params.offset, params.offset + 3);
  });
  const tokens = await getBridgeEmailTokens([...addresses.map(a => `0x${a.toUpperCase()}`), addresses[0], "invalid"]);
  assert.equal(tokens.size, 44);
  assert.equal(tokens.get(addresses[0])?.decimals, 0);
  assert.equal(tokens.get(addresses[1])?.decimals, 6);
  assert.equal(tokens.get(addresses[2])?.decimals, 18);
  for (const address of addresses.slice(3, 9)) assert.equal(tokens.get(address)?.decimals, undefined);
  assert.equal(tokens.get(addresses[44])?.symbol, "TOKEN44");
  assert.ok(calls > 3, "all batches must read beyond the server row cap");
});

test("admin review queries paginate both bridges and exclude automatic native delays", async t => {
  const withdrawals = Array.from({ length: 45 }, (_, i) => ({ ...withdrawal(i), value: { ...withdrawal(i).value, status: i % 2 ? "3" : "2" } }));
  const deposits = Array.from({ length: 7 }, (_, i) => ({ ...deposit(i), value: { ...deposit(i).value, status: "2" } }));
  const calls = await mockCirrus(t, {
    [`${external}-withdrawals`]: withdrawals,
    [`${external}-deposits`]: deposits,
    [`${external}-withdrawalManualReviews`]: withdrawals.map(row => ({ key: row.key, value: {} })),
    [`${external}-withdrawalAuthorizations`]: withdrawals.map(row => ({ key: row.key, value: {} })),
    [`${native}-withdrawals`]: [false, true].map((useInstantPath, i) => ({ key: String(i), value: { bridgeStatus: "2", useInstantPath } })),
  });
  const { getBridgeReviewRecords } = await import("./cirrusService");
  const records = await getBridgeReviewRecords();
  assert.equal(records.deposits.length, 7);
  assert.equal(records.withdrawals.length, 45);
  assert.equal(records.reviews.length, 23);
  assert.equal(records.authorizations.length, 22);
  assert.deepEqual(records.nativeWithdrawals.map(row => row.key), ["0"]);
  assert.ok(calls.every(call => call.params.address === `eq.${"1".repeat(40)}`));
});

test("review outcomes require a terminal funds state, never just a rejected or absent record", async t => {
  const { cirrus } = await import("../utils/api");
  const { getBridgeReviewOutcome } = await import("./cirrusService");
  let value: any;
  const calls: any[] = [];
  t.mock.method(cirrus, "get", async (path: string, { params }: any) => {
    calls.push({ path, params });
    return value ? [{ value }] : [];
  });
  const item: any = { id: `eab:deposit:1:0x${router}:2`, source: "eab", kind: "deposit_recovery", reference: "2" };
  for (const status of [undefined, "0", "2", "7", "8", "garbled"]) {
    value = status ? { status } : undefined;
    assert.equal(await getBridgeReviewOutcome(item), undefined);
  }
  value = { status: "6" };
  assert.equal(await getBridgeReviewOutcome(item), "refunded");
  value = { status: "4" };
  assert.equal(await getBridgeReviewOutcome(item), "delivered");
  assert.equal(calls[0].params.address, `eq.${"1".repeat(40)}`);
  assert.equal(calls[0].params.key, "eq.1");
  assert.equal(calls[0].params.key2, `eq.${router}`);
  assert.equal(calls[0].params.key3, "eq.2");
  const native = { ...item, id: "native:deposit:8:", reference: "8", source: "native" as const };
  value = { bridgeStatus: "4" };
  assert.equal(await getBridgeReviewOutcome(native), undefined, "native abort did not restore burned assets");
  value = { bridgeStatus: "3" };
  assert.equal(await getBridgeReviewOutcome(native), "delivered");
  value = { status: "6" };
  assert.equal(await getBridgeReviewOutcome({ ...item, id: "eab:withdrawal:2", kind: "withdrawal_refund" }), "refunded");
});

test("malformed indexed attestation counts cannot enable refund preparation", async t => {
  const { cirrus } = await import("../utils/api");
  const { getSettlementAttestationCount } = await import("./cirrusService");
  let value: any = "NaN";
  t.mock.method(cirrus, "get", async () => [{ value }]);
  for (value of ["NaN", "-1", "1.5", "9007199254740993"]) {
    await assert.rejects(getSettlementAttestationCount("0x" + "a".repeat(64)), /Invalid indexed/);
  }
  value = "2";
  assert.equal(await getSettlementAttestationCount("0x" + "a".repeat(64)), 2);
});

test("paused and disabled chains retain READY recovery using the committed vault", async t => {
  const ready = { ...withdrawal(1), bridge: { withdrawalsPaused: true }, value: { ...withdrawal(1).value, status: "3" } };
  const initiated = { ...withdrawal(2), bridge: { withdrawalsPaused: true } };
  const calls = await mockCirrus(t, {
    [`${external}-chains`]: [{ key: "1", value: { enabled: false, vault: target } }],
    [`${external}-withdrawals`]: [ready, initiated],
    [`${external}-withdrawalAuthorizations`]: [{ key: ready.key, value: { destinationVault: router, notBefore: "100", signerSetVersion: "1" } }],
  });
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const [row] = await getExternalWithdrawalsByStatus("3");
  assert.equal(row.vault, router);
  assert.equal(row.recoveryOnly, true);
  assert.equal(calls.find(call => call.path.endsWith("-withdrawals"))!.params["bridge.withdrawalsPaused"], undefined);
  assert.deepEqual(await getExternalWithdrawalsByStatus("1"), []);
});

test("review approval scan ignores zero and malformed values and preserves large IDs", async t => {
  await mockCirrus(t, {
    [`${external}-deposits`]: ["2", "2", "2", "2", "8", "7", "4"].map((status, index) => ({ key: "1", key2: router, key3: id(index + 1), value: { status } })),
    [`${external}-depositReviewApprovals`]: [
    { key: "1", key2: router, key3: id(1), value: "a".repeat(64) },
    { key: "1", key2: router, key3: id(2), value: "0x" + "b".repeat(64) },
    { key: "1", key2: router, key3: id(3), value: "0x" + "0".repeat(64) },
    { key: "1", key2: router, key3: id(4), value: "invalid" },
    ...[5, 6, 7].map(index => ({ key: "1", key2: router, key3: id(index), value: "a".repeat(64) })),
  ] });
  const { getDepositReviewApprovals } = await import("./cirrusService");
  assert.deepEqual([...await getDepositReviewApprovals(1)], [`${router}:${id(1)}`, `${router}:${id(2)}`]);
});

for (const [method, table, rows, identity] of [
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

test("withdrawal reads normalize unset Cirrus hashes and preserve real reservation records", async (t) => {
  const hashes = [undefined, null, "", "0".repeat(40), `0x${"0".repeat(64)}`, `0X${"0".repeat(64)}`, `0x${"a".repeat(64)}`];
  const rows = hashes.map((hash, i) => ({ ...withdrawal(i), value: {
    ...withdrawal(i).value, reservationId: hash, reservationTxHash: hash,
    cancellationTxHash: hash, externalTxHash: hash,
  } }));
  await mockCirrus(t, { [`${external}-withdrawals`]: rows });
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const result = await getExternalWithdrawalsByStatus("1");
  for (const [i, row] of result.entries()) {
    for (const field of ["reservationId", "reservationTxHash", "cancellationTxHash", "externalTxHash"]) {
      assert.equal((row as any)[field], i === hashes.length - 1 ? hashes[i] : undefined, field);
    }
  }
});

test("READY withdrawal with Cirrus zero hashes reserves and releases instead of reporting a mismatch", async (t) => {
  await mockCirrus(t, { [`${external}-withdrawals`]: [{ ...withdrawal(1), bridge: { withdrawalsPaused: false }, value: {
    ...withdrawal(1).value, status: "3", reservationId: "0".repeat(40), cancellationTxHash: "0".repeat(40),
  } }] });
  const { getExternalWithdrawalsByStatus } = await import("./cirrusService");
  const { processExternalWithdrawal } = await import("./bridgeService");
  const { eth } = await import("../utils/api");
  const vault = await import("./externalWithdrawalService");
  const strato = await import("../utils/stratoHelper");
  const attestation = await import("./settlementAttestationService");
  const trace: string[] = [];
  t.mock.method(eth, "get", async () => ({ networkID: "9001" }));
  t.mock.method(vault, "buildWithdrawalAuthorization", async () => ({ deadline: "2800", signerSetVersion: "1" } as any));
  t.mock.method(vault, "getReservationState", async (_authorization, includeHash) => {
    assert.equal(includeHash, true);
    return { reservationId: "reservation", status: 0, latestTimestamp: 1000n, signerSetVersion: 1n };
  });
  t.mock.method(vault, "reserveWithdrawal", async () => {
    trace.push("reserve");
    return { reservationId: "reservation", transactionHash: "reserve-hash" };
  });
  t.mock.method(strato, "execute", async (input: any) => {
    trace.push(input.method);
    assert.equal(input.args.reservationId, "reservation");
    assert.equal(input.args.reservationTxHash, "reserve-hash");
    return { status: "Success" } as any;
  });
  t.mock.method(vault, "releaseWithdrawal", async () => { trace.push("release"); return "release-hash"; });
  t.mock.method(attestation, "attestWithdrawalRelease", async () => { trace.push("attest"); });
  t.mock.method(strato, "executeAsRelayer", async (input: any) => {
    trace.push(input.method);
    assert.equal(input.args.externalTxHash, "release-hash");
    return { status: "Success" } as any;
  });
  const [row] = await getExternalWithdrawalsByStatus("3");
  await processExternalWithdrawal(row);
  assert.deepEqual(trace, ["reserve", "recordWithdrawalReservation", "release", "attest", "finalizeWithdrawal"]);
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

test("asset and rebase lookups batch and paginate their ID lists", async (t) => {
  const addresses = Array.from({ length: 45 }, (_, i) => i.toString(16).padStart(40, "0"));
  await mockCirrus(t, {
    [external]: [{ priceOracle: target }],
    [`${external}-routes`]: addresses.map((key) => ({ key, key2: "1", key3: target, value: { externalDecimals: "6" } })),
    "/BlockApps-PriceOracle-rebaseFactors": addresses.map((key) => ({ key, value: "100" })),
  });
  const service = await import("./cirrusService");
  assert.equal((await service.getAssetInfo(addresses as [string, ...string[]])).size, 45);
  assert.equal((await service.getRebaseFactors([...addresses, addresses[0]])).size, 45);
  assert.equal((await service.getExternalBridgeRebaseFactors(addresses)).size, 45);
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

test("review approval reads use the stored mapping and preserve the composite identity", async t => {
  const { cirrus } = await import("../utils/api");
  const { getDepositReviewApproval } = await import("./cirrusService");
  let approval: any = "A".repeat(64);
  t.mock.method(cirrus, "get", async (url: string, { params }: any) => {
    assert.ok(url.endsWith("-depositReviewApprovals"));
    assert.equal(params.key, "eq.1"); assert.equal(params.key2, `eq.${router}`);
    assert.equal(params.key3, `eq.${id(1)}`); assert.equal(params.select, "value");
    return [{ value: approval }];
  });
  assert.equal(await getDepositReviewApproval(1, "0x" + router.toUpperCase(), id(1)), "0x" + "a".repeat(64));
  for (approval of [undefined, 1, "invalid"]) assert.equal(await getDepositReviewApproval(1, router, id(1)), undefined);
});


test("native refund evidence is indexed into the review queue without implying completion", async t => {
  const key = "e".repeat(64), hash = "0x" + "f".repeat(64);
  const calls = await mockCirrus(t, {
    [`${native}-deposits`]: [{ key, value: { bridgeStatus: "7", externalChainId: "1" } }],
    [`${native}-depositRefundEvidence`]: [{ key, value: hash }],
    [`${native}-withdrawals`]: [{ key: "7", value: { bridgeStatus: "3", externalTxHash: hash } }],
  });
  const { getBridgeReviewRecords, getNativeDepositRefundEvidence, getNativeWithdrawalById } = await import("./cirrusService");
  const { buildBridgeReviewQueue } = await import("@strato/shared-types");
  const item = buildBridgeReviewQueue(await getBridgeReviewRecords()).find(item => item.source === "native")!;
  assert.equal(item.refundEvidenceHash, hash);
  assert.equal(item.recoveryStatus, "refund_pending");
  assert.deepEqual(item.actions, ["confirm_refund"]);
  assert.equal(await getNativeDepositRefundEvidence(key), hash);
  assert.equal((await getNativeWithdrawalById("7"))?.externalTxHash, hash);
  assert.equal(await getNativeWithdrawalById("8"), undefined);
  await assert.rejects(getNativeWithdrawalById("7,8"), /Invalid/);
  assert.ok(calls.every(call => call.params.address === `eq.${"1".repeat(40)}`));
});

test("native role checks load all representation tokens for the chain, including disabled routes", async t => {
  const { getNativeRepresentationTokens } = await import("./cirrusService");
  const rows = Array.from({ length: 7 }, (_, i) => ({ key: String(i), key2: "11155111", value: {
    enabled: i % 2 === 0, representationToken: i.toString(16).padStart(40, "a"),
  } }));
  const calls = await mockCirrus(t, { [`${native}-assets`]: [
    ...rows, { key: "other", key2: "1", value: { representationToken: "wrong-chain" } },
  ] }, 2);
  assert.deepEqual(await getNativeRepresentationTokens(11155111), rows.map(row => row.value.representationToken));
  assert.ok(calls.length > 1);
});
