import assert from "node:assert/strict";
import test from "node:test";
import {
  decideFill,
  addExposure,
  releaseExposure,
  buildFillTxs,
  FastFillPolicy,
  FillCandidate,
  Exposure,
} from "./fastFillService";

const TOKEN = "0x93fb7295859b2d70199e0a4883b7c320cf874e6c";
const OTHER_TOKEN = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce";
const BRIDGE_IN = "0x938594151102d172a08925c104cf044a448f995c";
const KEY = "0xde22f291c4f5f52e028361e9ca3537c376b4d2fc8f89ebe630d3f9218948e964";

const policy = (over: Partial<FastFillPolicy> = {}): FastFillPolicy => ({
  enabled: true,
  minConfirmations: 3,
  maxFillAmount: 1_000_000n,
  maxInFlightPerToken: 2_000_000n,
  maxInFlightTotal: 5_000_000n,
  allowedChainIds: [11155111],
  allowedStratoTokens: [TOKEN],
  ...over,
});

const candidate = (over: Partial<FillCandidate> = {}): FillCandidate => ({
  depositKey: KEY,
  externalChainId: 11155111,
  amount: 1000n,
  maxFee: 0n,
  stratoRecipient: RECIPIENT,
  targetStratoToken: TOKEN,
  confirmations: 5,
  alreadyFilled: false,
  alreadyClaimed: false,
  ...over,
});

const noExposure = (): Exposure => ({ total: 0n, byToken: {} });

// ── Happy path ────────────────────────────────────────────────────────────

test("fills a healthy candidate, paying amount - maxFee", () => {
  const d = decideFill(candidate({ amount: 1000n, maxFee: 25n }), policy(), noExposure());
  assert.deepEqual(d, { fill: true, payAmount: 975n });
});

test("a zero-fee deposit is still filled -- BlockApps fills for UX, not profit", () => {
  const d = decideFill(candidate({ maxFee: 0n }), policy(), noExposure());
  assert.equal(d.fill, true);
  assert.equal((d as { payAmount: bigint }).payAmount, 1000n, "fronts the full amount");
});

// ── Terminal states ───────────────────────────────────────────────────────

test("never fills an already-claimed deposit", () => {
  const d = decideFill(candidate({ alreadyClaimed: true }), policy(), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /already claimed/);
});

test("never double-fills", () => {
  const d = decideFill(candidate({ alreadyFilled: true }), policy(), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /already filled/);
});

// ── Reorg exposure ────────────────────────────────────────────────────────

test("waits for minConfirmations before believing a deposit", () => {
  const d = decideFill(candidate({ confirmations: 2 }), policy({ minConfirmations: 3 }), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /2\/3 confirmations/);
});

test("fills exactly at the confirmation threshold", () => {
  const d = decideFill(candidate({ confirmations: 3 }), policy({ minConfirmations: 3 }), noExposure());
  assert.equal(d.fill, true);
});

// ── Reimbursability ───────────────────────────────────────────────────────

test("refuses chains with no trustless bridge-in, which could never reimburse", () => {
  // Reimbursement happens inside EthBridgeIn.claim; without one the fill is a donation.
  const d = decideFill(candidate({ externalChainId: 46630 }), policy(), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /not enabled for fast fill/);
});

test("refuses tokens we hold no inventory in", () => {
  const d = decideFill(candidate({ targetStratoToken: OTHER_TOKEN }), policy(), noExposure());
  assert.equal(d.fill, false);
});

test("matches the allowed token case-insensitively and without 0x", () => {
  const d = decideFill(
    candidate({ targetStratoToken: TOKEN.slice(2).toUpperCase() }),
    policy(),
    noExposure(),
  );
  assert.equal(d.fill, true, "address formatting must not silently disable fills");
});

// ── Caps ──────────────────────────────────────────────────────────────────

test("refuses a deposit above the per-fill cap", () => {
  const d = decideFill(candidate({ amount: 2_000_000n }), policy({ maxFillAmount: 1_000_000n }), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /per-fill cap/);
});

test("refuses once the per-token in-flight cap would be exceeded", () => {
  const ex: Exposure = { total: 1_900_000n, byToken: { [TOKEN.slice(2)]: 1_900_000n } };
  const d = decideFill(candidate({ amount: 200_000n }), policy({ maxInFlightPerToken: 2_000_000n }), ex);
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /per-token in-flight/);
});

test("refuses once the total in-flight cap would be exceeded", () => {
  const ex: Exposure = { total: 4_900_000n, byToken: { [TOKEN.slice(2)]: 100n } };
  const d = decideFill(candidate({ amount: 200_000n }), policy({ maxInFlightTotal: 5_000_000n }), ex);
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /total in-flight/);
});

test("a cap is a ceiling, not a limit to cross -- exact fit is allowed", () => {
  const ex: Exposure = { total: 0n, byToken: {} };
  const d = decideFill(candidate({ amount: 1_000_000n }), policy({ maxFillAmount: 1_000_000n }), ex);
  assert.equal(d.fill, true);
});

// ── Malformed input ───────────────────────────────────────────────────────

test("refuses a fee at or above the amount", () => {
  const d = decideFill(candidate({ amount: 100n, maxFee: 100n }), policy(), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /maxFee >= amount/);
});

test("refuses a zero amount", () => {
  const d = decideFill(candidate({ amount: 0n }), policy(), noExposure());
  assert.equal(d.fill, false);
});

test("the kill switch beats everything", () => {
  const d = decideFill(candidate(), policy({ enabled: false }), noExposure());
  assert.equal(d.fill, false);
  assert.match((d as { reason: string }).reason, /disabled/);
});

// ── Exposure accounting ───────────────────────────────────────────────────

test("exposure accumulates and releases per token", () => {
  let ex = noExposure();
  ex = addExposure(ex, TOKEN, 100n);
  ex = addExposure(ex, TOKEN, 50n);
  assert.equal(ex.total, 150n);
  assert.equal(ex.byToken[TOKEN.slice(2)], 150n);

  ex = releaseExposure(ex, TOKEN, 100n);
  assert.equal(ex.total, 50n);
  assert.equal(ex.byToken[TOKEN.slice(2)], 50n);
});

test("releasing more than is held floors at zero rather than underflowing", () => {
  // bigint underflow would go negative and silently raise the effective cap.
  let ex = addExposure(noExposure(), TOKEN, 10n);
  ex = releaseExposure(ex, TOKEN, 999n);
  assert.equal(ex.total, 0n);
  assert.equal(ex.byToken[TOKEN.slice(2)], 0n);
});

// ── Transaction shape ─────────────────────────────────────────────────────

test("plans an approve scoped to exactly this fill, then fastFill", () => {
  const c = candidate({ maxFee: 25n });
  const txs = buildFillTxs(BRIDGE_IN, c, 975n);
  assert.equal(txs.length, 2);
  assert.equal(txs[0].method, "approve");
  assert.equal(txs[0].args.value, "975", "allowance must not exceed the fill");
  assert.equal(txs[1].method, "fastFill");
  assert.equal(txs[1].args.payAmount, "975");
  assert.equal(txs[1].args.recipient, RECIPIENT.slice(2));
  assert.equal(txs[1].args.stratoToken, TOKEN.slice(2));
});
