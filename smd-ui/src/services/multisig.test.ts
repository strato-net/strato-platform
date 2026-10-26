import assert from "node:assert/strict";
import { test } from "node:test";
import { applyConfirmedVote, buildNestedCastVotePayload, buildOpenIssues, mergeIndexedIssues, normalizeArgs, votesNeeded } from "./multisig";
import { formatVariadicArg, parseArgText } from "../lib/args";
import { pollResults } from "../lib/walletTx";
import { api } from "../lib/api";

const wallet = "efa890674cad5e3a7640bb720c2a70bf3ae76709";
const pool = "5b8f21b53d3a5ea7dd66710ff18d161bb62e9a71";
const signer = "fdb36b791a35ba52798bbc46ab066587cb60e032";
const issueId = "52532c8feb812ff4e65396f5e2a8d48daced7e8dad0ced68a278b65ece5f353c";
const args = `["${wallet}",false,50000000000000001,0,614301652391,1792964287]`;
const created = [{ attributes: { issueId, target: pool, func: "swap", args }, block_number: "867162" }];

test("array length metadata never counts as a signer vote", () => {
  const issues = buildOpenIssues([
    { key: { key: issueId }, value: { length: "1" } },
    { key: { key: issueId, key2: "0" }, value: signer },
    { key: { key: issueId, key2: "0" }, value: signer },
    { key: { key: "cleared", key2: "0" }, value: "0000000000000000000000000000000000000000" },
  ], created);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].voters, [signer]);
  assert.equal(votesNeeded(3, 6000), 2);
});

test("a reloaded swap preserves its boolean and exact integer arguments for voting and simulation", () => {
  const decoded = normalizeArgs(args);
  const payload = buildNestedCastVotePayload([wallet], "swap", decoded, pool) as any;
  assert.deepEqual(payload.args._args, [wallet, "bool(false)", "50000000000000001", "0", "614301652391", "1792964287"]);
});

test("nested voting preserves the same typed swap arguments", () => {
  const payload = buildNestedCastVotePayload([signer, wallet], "swap", normalizeArgs(args), pool) as any;
  assert.deepEqual(payload.args._args.slice(0, 4), [pool, "swap", wallet, "bool(false)"]);
});

test("cleared vote rows and array metadata do not resurrect an executed issue", () => {
  assert.deepEqual(buildOpenIssues([
    { key: { key: issueId }, value: { length: "0" } },
    { key: { key: issueId, key2: "0" }, value: "" },
  ], created), []);
});

test("plain boolean form input and the explicit cast produce the same typed argument", () => {
  assert.equal(formatVariadicArg(parseArgText("false")), "bool(false)");
  assert.equal(formatVariadicArg(parseArgText("bool(false)")), "bool(false)");
  assert.equal(formatVariadicArg(parseArgText("true")), "bool(true)");
});

const proposal = { target: pool, func: "swap", args: normalizeArgs(args), voters: [signer] };
const receipt = { status: "Success", hash: "receipt", data: { tag: "Call", contents: [false, issueId] } };

test("a confirmed proposal stays visible until both indexed metadata and votes arrive", () => {
  const cached = applyConfirmedVote([], receipt, proposal);
  assert.equal(cached[0].issueId, issueId);
  assert.equal(cached[0].indexing, true);
  assert.deepEqual(mergeIndexedIssues([], cached), cached);
  const incomplete = buildOpenIssues([{ key: { key: issueId, key2: "0" }, value: signer }], []);
  assert.equal(mergeIndexedIssues(incomplete, cached)[0].func, "swap");
  const indexed = buildOpenIssues([{ key: { key: issueId, key2: "0" }, value: signer }], created);
  const settled = mergeIndexedIssues(indexed, cached);
  assert.equal(settled[0].indexing, undefined);
  assert.deepEqual(settled[0].voters, [signer]);
});

test("a confirmed proposal is removed once its execution is indexed", () => {
  const cached = applyConfirmedVote([], receipt, proposal);
  const events = [
    { ...created[0], event_name: "IssueCreated", transaction_hash: "receipt" },
    { event_name: "IssueExecuted", attributes: { issueId }, block_number: "867163" },
  ];
  assert.deepEqual(mergeIndexedIssues([], cached, events), []);
  const staleVotes = [{ key: { key: issueId, key2: "0" }, value: signer }];
  assert.deepEqual(buildOpenIssues(staleVotes, events), []);
});

test("pending and failed transactions cannot create a confirmed proposal", () => {
  assert.deepEqual(applyConfirmedVote([], { ...receipt, status: "Pending" }, proposal), []);
  assert.deepEqual(applyConfirmedVote([], { ...receipt, status: "Failure" }, proposal), []);
  assert.deepEqual(applyConfirmedVote([], { status: "Success" }, proposal), []);
});

test("a successful second vote removes the matching proposal without adding another vote", () => {
  const cached = applyConfirmedVote([], receipt, proposal);
  assert.deepEqual(applyConfirmedVote(cached, {
    status: "Success", data: { tag: "Call", contents: [true, []] },
  }, proposal), []);
});

test("typed VM responses also keep confirmed proposals visible", () => {
  const cached = applyConfirmedVote([], {
    status: "Success", hash: "receipt", txResult: { response: {
      t: "tup", v: [{ t: "bool", v: false }, { t: "str", v: issueId }],
    } },
  }, proposal);
  assert.equal(cached[0].issueId, issueId);
});

test("empty, partial, and pending result lists are polled until every hash is confirmed", async () => {
  const previousAdapter = api.defaults.adapter;
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: "" } as Document;
  let calls = 0;
  const responses = [[], [{ hash: "one", status: "Success" }],
    [{ hash: "one", status: "Success" }, { hash: "two", status: "Pending" }],
    [{ hash: "one", status: "Success" }, { hash: "two", status: "Success" }]];
  api.defaults.adapter = async (config) => ({ data: responses[calls++], status: 200, statusText: "OK", headers: {}, config });
  try {
    const results = await pollResults(["one", "two"], signer, 1000, 0);
    assert.equal(calls, 4);
    assert.equal(results.length, 2);
  } finally {
    api.defaults.adapter = previousAdapter;
    globalThis.document = previousDocument;
  }
});

test("an unconfirmed timeout throws instead of reporting a successful transaction", async () => {
  const previousAdapter = api.defaults.adapter;
  const previousDocument = globalThis.document;
  globalThis.document = { cookie: "" } as Document;
  api.defaults.adapter = async (config) => ({ data: [], status: 200, statusText: "OK", headers: {}, config });
  try {
    await assert.rejects(pollResults(["one"], signer, 0, 0), /confirmation timed out/);
  } finally {
    api.defaults.adapter = previousAdapter;
    globalThis.document = previousDocument;
  }
});
