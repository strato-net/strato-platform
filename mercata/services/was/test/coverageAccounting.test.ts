/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createProvenanceEngine } from "../src/provenanceEngine";
import {
  CirrusEventRow,
  TraceCursor,
  TraceEdge,
  TraceLot,
  TrustAnchor,
  WithdrawalCandidateRepository,
} from "../src/types";

const owner = "3333333333333333333333333333333333333333";
const sender = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const token = "4444444444444444444444444444444444444444";
const inputToken = "cccccccccccccccccccccccccccccccccccccccc";

const withdrawal = {
  routeType: "standard" as const,
  withdrawalId: "1",
  bridgeStatus: "2",
  stratoSender: owner,
  stratoToken: token,
  stratoTokenAmount: "100",
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

const transferLot = (
  amount: string,
  overrides: Partial<TraceLot> = {},
): TraceLot => {
  const transfer = event("Transfer", {
    from: sender,
    to: owner,
    value: amount,
  });
  return {
    owner,
    token,
    amount,
    source: "transfer",
    transactionHash: transfer.transaction_hash,
    blockNumber: transfer.block_number,
    event: transfer,
    ...overrides,
  };
};

const swapLot = (): TraceLot => {
  const swap = event("Swap", {
    sender: owner,
    tokenIn: inputToken,
    amountIn: "110",
    tokenOut: token,
    amountOut: "100",
  });
  return {
    owner,
    token,
    amount: "100",
    source: "swap",
    transactionHash: swap.transaction_hash,
    blockNumber: swap.block_number,
    event: swap,
  };
};

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
      stratoTokenAmount: "100",
      withdrawalId: "1",
    }),
  fetchFundingLots,
  fetchTrustAnchor,
});

const assertCoverageSum = (coverage: {
  clean: string;
  tainted: string;
  unknown: string;
}) => {
  assert.equal(
    (
      BigInt(coverage.clean) +
      BigInt(coverage.tainted) +
      BigInt(coverage.unknown)
    ).toString(),
    withdrawal.stratoTokenAmount,
  );
};

test("traceWithdrawal marks single trusted lot clean", async () => {
  const repository = repositoryFor(
    async () => [transferLot("100")],
    async (edge) => trustAnchorFor(edge),
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
  });

  assert.equal(trace.coverage?.clean, "100");
  assert.equal(trace.coverage?.tainted, "0");
  assert.equal(trace.coverage?.unknown, "0");
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal splits coverage across multiple trusted lots", async () => {
  const repository = repositoryFor(
    async () => [transferLot("70"), transferLot("30")],
    async (edge) => trustAnchorFor(edge),
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
  });

  assert.equal(trace.coverage?.clean, "100");
  assert.equal(trace.coverage?.unknown, "0");
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal does not double count swap input and output amounts", async () => {
  const repository = repositoryFor(
    async (cursor) => {
      if (cursor.token === token) return [swapLot()];
      if (cursor.token === inputToken) {
        return [
          transferLot("110", {
            owner,
            token: inputToken,
            amount: "110",
          }),
        ];
      }
      return [];
    },
    async (edge) => (edge.type === "transfer" ? trustAnchorFor(edge) : null),
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
  });

  assert.equal(trace.coverage?.clean, "100");
  assert.equal(trace.coverage?.unknown, "0");
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal marks remaining coverage unknown at max depth", async () => {
  const repository = repositoryFor(
    async () => [swapLot()],
    async () => null,
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
    maxDepth: 1,
  });

  assert.equal(trace.coverage?.clean, "0");
  assert.equal(trace.coverage?.unknown, "100");
  assert.equal(trace.stoppedEarly, true);
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal marks only missing evidence coverage unknown", async () => {
  const repository = repositoryFor(
    async (cursor) => {
      if (cursor.token === token) return [swapLot()];
      return [];
    },
    async () => null,
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
  });

  assert.equal(trace.coverage?.clean, "0");
  assert.equal(trace.coverage?.unknown, "100");
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal rejects unverified zero-address transfer mint", async () => {
  let fundingFetches = 0;
  const repository = repositoryFor(
    async () => {
      fundingFetches += 1;
      return [
        transferLot("100", {
          event: event("Transfer", {
            from: "0000000000000000000000000000000000000000",
            to: owner,
            value: "100",
          }),
        }),
      ];
    },
    async () => null,
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
  });

  assert.equal(fundingFetches, 1);
  assert.equal(trace.decision, "REJECT");
  assert.equal(trace.riskLevel, "high");
  assert.equal(trace.coverage?.clean, "0");
  assert.equal(trace.coverage?.tainted, "100");
  assert.equal(trace.coverage?.unknown, "0");
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal stops at configured skipped address", async () => {
  let fundingFetches = 0;
  const repository = repositoryFor(
    async () => {
      fundingFetches += 1;
      return [transferLot("100")];
    },
    async () => null,
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
    skipAddresses: [owner],
  });

  assert.equal(fundingFetches, 0);
  assert.equal(trace.coverage?.clean, "0");
  assert.equal(trace.coverage?.unknown, "100");
  assert.ok(
    trace.traceTree.children.some((child) => child.label === "SkippedAddress"),
  );
  assertCoverageSum(trace.coverage!);
});

test("traceWithdrawal treats configured trusted protocol address as clean", async () => {
  let fundingFetches = 0;
  const repository = repositoryFor(
    async () => {
      fundingFetches += 1;
      return [transferLot("100")];
    },
    async () => null,
  );
  const trace = await createProvenanceEngine(repository).traceWithdrawal({
    withdrawal,
    trustedProtocolAddresses: [owner],
  });

  assert.equal(fundingFetches, 0);
  assert.equal(trace.coverage?.clean, "100");
  assert.equal(trace.coverage?.unknown, "0");
  assert.ok(
    trace.traceTree.children.some((child) => child.label === "TrustedProtocolAddress"),
  );
  assertCoverageSum(trace.coverage!);
});

