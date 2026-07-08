/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTraceCoverage,
  createProvenanceEngine,
} from "../src/provenanceEngine";
import {
  CirrusEventRow,
  TraceCursor,
  TraceEdge,
  TraceLot,
  TrustAnchor,
  WithdrawalCandidateRepository,
} from "../src/types";

const owner = "3333333333333333333333333333333333333333";
const token = "4444444444444444444444444444444444444444";
const amount = "100";

const withdrawal = {
  routeType: "standard" as const,
  withdrawalId: "1",
  bridgeStatus: "2",
  stratoSender: owner,
  stratoToken: token,
  stratoTokenAmount: amount,
  externalChainId: "1",
  externalRecipient: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

const event = (
  eventName: string,
  attributes: CirrusEventRow["attributes"],
): CirrusEventRow => ({
  event_name: eventName,
  address: token,
  attributes,
  block_number: "99",
  block_timestamp: "2026-01-01 00:00:00 UTC",
  transaction_hash: `0x${eventName}`,
  transaction_sender: owner,
});

const lot = (): TraceLot => ({
  owner,
  token,
  amount,
  source: "transfer",
  transactionHash: "0xtransfer",
  blockNumber: "99",
  event: event("Transfer", {
    from: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: owner,
    value: amount,
  }),
});

const trustAnchorFor = (edge: TraceEdge): TrustAnchor => ({
  type: "MercataBridge.DepositCompleted",
  owner: edge.to.owner,
  token: edge.to.token,
  amount: edge.to.amount,
  event: event("DepositCompleted", {
    stratoRecipient: edge.to.owner,
    stratoToken: edge.to.token,
    stratoTokenAmount: edge.to.amount,
  }),
});

const repositoryFor = (
  fetchFundingLots: (cursor: TraceCursor) => Promise<TraceLot[]>,
  fetchTrustAnchor: (edge: TraceEdge) => Promise<TrustAnchor | null>,
): WithdrawalCandidateRepository => ({
  fetchWithdrawalCandidates: async () => [],
  fetchCanonicalWithdrawalEvent: async () =>
    event("WithdrawalRequested", {
      user: owner,
      token,
      stratoTokenAmount: amount,
      withdrawalId: "1",
    }),
  fetchFundingLots,
  fetchTrustAnchor,
});

test("traceWithdrawal approves all-clean coverage as low risk", async () => {
  const trace = await createProvenanceEngine(
    repositoryFor(async () => [lot()], async (edge) => trustAnchorFor(edge)),
  ).traceWithdrawal({ withdrawal });

  assert.equal(trace.decision, "APPROVE");
  assert.equal(trace.riskLevel, "low");
  assert.ok(trace.summary.some((line) => line.includes("verified trust anchors")));
});

test("classifyTraceCoverage approves all-clean coverage as low risk", () => {
  const classification = classifyTraceCoverage({
    clean: amount,
    tainted: "0",
    unknown: "0",
  });

  assert.equal(classification.decision, "APPROVE");
  assert.equal(classification.riskLevel, "low");
});

test("classifyTraceCoverage rejects tainted coverage as high risk", () => {
  const classification = classifyTraceCoverage({
    clean: "0",
    tainted: amount,
    unknown: "0",
  });

  assert.equal(classification.decision, "REJECT");
  assert.equal(classification.riskLevel, "high");
  assert.ok(classification.summary.includes("tainted"));
});

test("classifyTraceCoverage sends unknown coverage to manual review", () => {
  const classification = classifyTraceCoverage({
    clean: "0",
    tainted: "0",
    unknown: amount,
  });

  assert.equal(classification.decision, "MANUAL_REVIEW");
  assert.equal(classification.riskLevel, "medium");
});

test("traceWithdrawal sends unknown coverage to manual review as medium risk", async () => {
  const trace = await createProvenanceEngine(
    repositoryFor(async () => [], async () => null),
  ).traceWithdrawal({ withdrawal });

  assert.equal(trace.decision, "MANUAL_REVIEW");
  assert.equal(trace.riskLevel, "medium");
  assert.ok(trace.summary.some((line) => line.includes("requires manual review")));
});

test("resolveTraceEdge flags zero-address transfer mint as tainted", async () => {
  const mintLot = lot();
  mintLot.event!.attributes.from = "0000000000000000000000000000000000000000";

  const edge = await createProvenanceEngine(
    repositoryFor(async () => [], async () => null),
  ).resolveTraceEdge(mintLot);

  assert.equal(edge.result, "tainted");
  assert.equal(edge.from, undefined);
  assert.ok(edge.explanation.includes("zero address"));
});

