/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { createProvenanceEngine } from "../src/provenanceEngine";
import {
  CirrusEventRow,
  TraceLot,
  WithdrawalCandidateRepository,
} from "../src/types";

const owner = "3333333333333333333333333333333333333333";
const token = "4444444444444444444444444444444444444444";
const amount = "100";

const repository = {} as WithdrawalCandidateRepository;
const engine = createProvenanceEngine(repository);

const event = (
  eventName: string,
  attributes: CirrusEventRow["attributes"],
): CirrusEventRow => ({
  event_name: eventName,
  address: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  attributes,
  block_number: "99",
  block_timestamp: "2026-01-01 00:00:00 UTC",
  transaction_hash: "0xedge",
  transaction_sender: owner,
});

const lot = (
  source: TraceLot["source"],
  sourceEvent: CirrusEventRow,
): TraceLot => ({
  owner,
  token,
  amount,
  source,
  transactionHash: sourceEvent.transaction_hash,
  blockNumber: sourceEvent.block_number,
  event: sourceEvent,
});

test("resolveTraceEdge traces transfer to sender", async () => {
  const transfer = event("Transfer", {
    from: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    to: owner,
    value: amount,
  });

  const edge = await engine.resolveTraceEdge(lot("transfer", transfer));

  assert.equal(edge.type, "transfer");
  assert.equal(edge.result, "info");
  assert.equal(edge.from?.owner, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(edge.from?.token, token);
  assert.equal(edge.from?.amount, amount);
  assert.equal(edge.to.owner, owner);
  assert.equal(edge.event, transfer);
});

test("resolveTraceEdge traces swap output to swap input", async () => {
  const swap = event("Swap", {
    sender: owner,
    tokenIn: "cccccccccccccccccccccccccccccccccccccccc",
    amountIn: "110",
    tokenOut: token,
    amountOut: amount,
  });

  const edge = await engine.resolveTraceEdge(lot("swap", swap));

  assert.equal(edge.type, "swap");
  assert.equal(edge.result, "info");
  assert.equal(edge.from?.owner, owner);
  assert.equal(edge.from?.token, "cccccccccccccccccccccccccccccccccccccccc");
  assert.equal(edge.from?.amount, "110");
});

test("resolveTraceEdge traces metal mint output to pay token", async () => {
  const metalMint = event("MetalMinted", {
    buyer: owner,
    payToken: "cccccccccccccccccccccccccccccccccccccccc",
    payAmount: "110",
    metalToken: token,
    metalAmount: amount,
  });

  const edge = await engine.resolveTraceEdge(lot("metal_mint", metalMint));

  assert.equal(edge.type, "metal_mint");
  assert.equal(edge.result, "info");
  assert.equal(edge.from?.owner, owner);
  assert.equal(edge.from?.token, "cccccccccccccccccccccccccccccccccccccccc");
  assert.equal(edge.from?.amount, "110");
});

test("resolveTraceEdge traces PSM mint output to deposited token", async () => {
  const psmMint = event("DirectPSMMinted", {
    user: owner,
    depositAmount: "110",
    mintAmount: amount,
    againstToken: "cccccccccccccccccccccccccccccccccccccccc",
  });

  const edge = await engine.resolveTraceEdge(lot("psm", psmMint));

  assert.equal(edge.type, "psm");
  assert.equal(edge.result, "info");
  assert.equal(edge.from?.owner, owner);
  assert.equal(edge.from?.token, "cccccccccccccccccccccccccccccccccccccccc");
  assert.equal(edge.from?.amount, "110");
});

test("resolveTraceEdge keeps CDP mint unknown until collateral semantics are verified", async () => {
  const cdpMint = event("USDSTMinted", {
    user: owner,
    asset: "cccccccccccccccccccccccccccccccccccccccc",
    amountUSD: amount,
  });

  const edge = await engine.resolveTraceEdge(lot("cdp_mint", cdpMint));

  assert.equal(edge.type, "cdp_mint");
  assert.equal(edge.result, "unknown");
  assert.equal(edge.from, undefined);
});

test("resolveTraceEdge keeps rewards unknown until funding semantics are verified", async () => {
  const rewards = event("RewardsClaimed", {
    user: owner,
    amount,
  });

  const edge = await engine.resolveTraceEdge(lot("rewards", rewards));

  assert.equal(edge.type, "rewards");
  assert.equal(edge.result, "unknown");
  assert.equal(edge.from, undefined);
});

test("resolveTraceEdge returns unknown for incomplete transfer evidence", async () => {
  const transfer = event("Transfer", {
    to: owner,
    value: amount,
  });

  const edge = await engine.resolveTraceEdge(lot("transfer", transfer));

  assert.equal(edge.type, "transfer");
  assert.equal(edge.result, "unknown");
  assert.equal(edge.from, undefined);
});

test("resolveTraceEdge returns unsupported unknown without event evidence", async () => {
  const edge = await engine.resolveTraceEdge({
    owner,
    token,
    amount,
    source: "unknown",
  });

  assert.equal(edge.type, "unsupported");
  assert.equal(edge.result, "unknown");
  assert.equal(edge.from, undefined);
});
