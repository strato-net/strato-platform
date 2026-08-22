import assert from "node:assert/strict";
import test from "node:test";
import JSONBig from "json-bigint";
import { bloc, cirrus, eth, strato } from "../../utils/appApiHelper";
import { constants } from "../../config/constants";
import { castVoteOnIssueById, createIssue } from "./user.service";

const JSONBigString = JSONBig({ storeAsString: true });

test("traces create-issue argument transformations through the STRATO request", async (t) => {
  const target = "0x1111111111111111111111111111111111111111";
  const user = "0x2222222222222222222222222222222222222222";
  const submittedArgs = [
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    "900719925474099312345678901234567890",
    true,
    "preserve surrounding spaces",
    ["first", "second"],
  ];

  t.mock.method(bloc, "get", (async (_token: string, path: string) => {
    assert.equal(path, `/contracts/contract/${target}/details`);
    return {
      status: 200,
      data: {
        _contractName: "ArgumentRecorder",
        _functions: {
          captureArguments: {
            _funcArgs: [
              ["labels", { index: 4, type: { tag: "Array", entry: { tag: "String" } } }],
              ["enabled", { index: 2, type: { tag: "Bool" } }],
              ["recipient", { index: 0, type: { tag: "Address" } }],
              ["label", { index: 3, type: { tag: "String" } }],
              ["amount", { index: 1, type: { tag: "Int", signed: false, bytes: 32 } }],
            ],
          },
        },
      },
    };
  }) as typeof bloc.get);

  t.mock.method(cirrus, "get", (async (_token: string, path: string) => {
    if (path.endsWith("-IssueCreated")) {
      return { status: 200, data: [{ issueId: "semantic-trace-issue" }] };
    }
    if (path.endsWith("-IssueVoted")) {
      return { status: 200, data: [] };
    }
    return { status: 200, data: [{ value: "1000000000000000000000000" }] };
  }) as typeof cirrus.get);

  let stratoBody: any;
  let serializedBody = "";
  t.mock.method(strato, "post", (async (
    _token: string,
    path: string,
    body: any,
    config: any,
  ) => {
    stratoBody = body;
    serializedBody = config.transformRequest[0](body);
    assert.equal(path, "/transaction/parallel?resolve=true");
    return {
      status: 200,
      data: [{ status: "Success", hash: "0xsemantictrace" }],
    };
  }) as typeof strato.post);

  const result = await createIssue(
    "access-token",
    user,
    target,
    "captureArguments",
    submittedArgs,
  );
  const sent = JSONBigString.parse(serializedBody);
  const sentArgs = sent.txs[0].payload.args;

  console.log("admin issue backend/STRATO arg trace", JSON.stringify({
    entry: submittedArgs,
    resolvedCall: stratoBody.txs[0].payload,
    serializedRequest: serializedBody,
    serializedArgs: sentArgs,
    exit: result,
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));

  assert.equal(sentArgs.recipient.type, "address");
  assert.equal(
    sentArgs.recipient.value,
    "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  );
  assert.equal(sentArgs.amount.type, "uint256");
  assert.equal(
    sentArgs.amount.value,
    submittedArgs[1],
    "the backend must preserve every large integer digit before STRATO",
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify({
      enabled: sentArgs.enabled,
      label: sentArgs.label,
      labels: sentArgs.labels,
    })),
    {
      enabled: { type: "bool", value: true },
      label: { type: "string", value: "preserve surrounding spaces" },
      labels: { type: "string[]", value: ["first", "second"] },
    },
  );
  assert.deepEqual(result, {
    status: "Success",
    hash: "0xsemantictrace",
    issueId: "semantic-trace-issue",
    governed: true,
  });
});

// ── castVoteOnIssueById: registry fallback ────────────────────────────────────
// The replay decodes the node's record of an issue's arguments back into the target's
// declared types, which the node cannot always accept back. These cover the fallback
// to the registry's variadic castVoteOnIssue and, more importantly, the guards that
// stop it from ever re-submitting a vote that already landed.

const ISSUE_ID = "7b7c156459da9461a2f4b64d3a6cee9eb2343f6daa99ec81dc4d4b7825ff2e1a";
const REWARDS = "170147f58738c9f46112a874030420b823901f3b";
const VOTER = "0x7b1f8cd02cd09ab9510e30fc8e15ff898a639771";

// As the node renders a struct array: type-name prefixed, so not strict JSON
const RENDERED_EVENTS =
  '[ActionableEvent {"eventName": "UiProbeDeposit", "actionType": 0},' +
  ' ActionableEvent {"eventName": "UiProbeWithdraw", "actionType": 1}]';

type VoteScenario = {
  txArgs?: any[];
  replayFailure?: "node" | "transport";
  executed?: any[];
  votes?: any[];
  unreadableIndex?: boolean;
  landedIssueId?: string;
};

const mockVoteScenario = (t: any, scenario: VoteScenario = {}) => {
  const posted: any[] = [];

  t.mock.method(bloc, "get", (async (_token: string, _path: string) => ({
    status: 200,
    data: {
      _contractName: "Rewards",
      _functions: {
        addPositionActivity: {
          _funcArgs: [
            ["name", { index: 0, type: { tag: "String" } }],
            ["emissionRate", { index: 1, type: { tag: "Int", signed: false, bytes: 32 } }],
            ["sourceContract", { index: 2, type: { tag: "Address" } }],
            ["actionableEvents", {
              index: 3,
              type: { tag: "Array", entry: { tag: "Struct", typedef: "ActionableEvent" } },
            }],
          ],
        },
      },
    },
  })) as typeof bloc.get);

  t.mock.method(eth, "get", (async (_token: string, _path: string) => ({
    status: 200,
    data: [{
      to: REWARDS,
      funcName: "addPositionActivity",
      args: scenario.txArgs ?? ["\"UI Arg Probe\"", "0", "\"0xdead0001\"", RENDERED_EVENTS],
    }],
  })) as typeof eth.get);

  t.mock.method(cirrus, "get", (async (_token: string, path: string, config: any) => {
    const params = config?.params ?? {};
    if (path.endsWith("-IssueCreated") && params.issueId?.startsWith("eq.")) {
      return {
        status: 200,
        data: [{
          issueId: ISSUE_ID,
          target: REWARDS,
          func: "addPositionActivity",
          args: `["UI Arg Probe", 0, "0xdead0001", ${RENDERED_EVENTS}]`,
          block_number: "100",
          transaction_hash: "0xcreatingtx",
        }],
      };
    }
    if (path.endsWith("-IssueCreated") || path.endsWith("-IssueVoted")) {
      return { status: 200, data: [{ issueId: scenario.landedIssueId ?? ISSUE_ID }] };
    }
    if (path.endsWith("-IssueExecuted")) {
      if (scenario.unreadableIndex) throw new Error("cirrus unavailable");
      return { status: 200, data: scenario.executed ?? [] };
    }
    if (path.endsWith("-votes")) {
      return { status: 200, data: scenario.votes ?? [] };
    }
    return { status: 200, data: [{ value: "1000000000000000000000000" }] };
  }) as typeof cirrus.get);

  t.mock.method(strato, "post", (async (_token: string, _path: string, body: any) => {
    posted.push(body.txs[0].payload);
    if (posted.length === 1 && scenario.replayFailure === "node") {
      return {
        status: 200,
        data: [{
          status: "Failure",
          hash: "0xreplayfail",
          txResult: {
            message: "argValueToValue: Expected TypeEnum to be a string, but got: ArgInt 0",
          },
        }],
      };
    }
    if (posted.length === 1 && scenario.replayFailure === "transport") {
      throw new Error("socket hang up");
    }
    return { status: 200, data: [{ status: "Success", hash: `0xvote${posted.length}` }] };
  }) as typeof strato.post);

  return posted;
};

test("votes by replaying the original transaction when it decodes", async (t) => {
  const posted = mockVoteScenario(t, {
    txArgs: ["\"UI Arg Probe\"", "0", "\"0xdead0001\"", '[{"eventName":"d","actionType":"Deposit"}]'],
  });

  const result = await castVoteOnIssueById("access-token", VOTER, ISSUE_ID);

  assert.equal(result.votedVia, "replay");
  assert.equal(posted.length, 1, "a successful replay must not also vote via the registry");
  assert.equal(posted[0].method, "addPositionActivity");
});

test("falls back to the registry when the recorded arguments cannot be decoded", async (t) => {
  const posted = mockVoteScenario(t);

  const result = await castVoteOnIssueById("access-token", VOTER, ISSUE_ID);

  assert.equal(result.votedVia, "registry");
  assert.equal(posted.length, 1, "the replay failed before submitting, so only the fallback is sent");
  assert.equal(posted[0].method, "castVoteOnIssue");
  assert.equal(posted[0].contractAddress, constants.adminRegistry);
  assert.equal(posted[0].args._target, REWARDS);
  assert.equal(posted[0].args._func, "addPositionActivity");
  // The node's rendering is repaired back into arguments, ordinals and all
  assert.deepEqual(
    JSON.parse(JSON.stringify(posted[0].args._args[3])),
    {
      type: "ActionableEvent[]",
      value: [
        { eventName: "UiProbeDeposit", actionType: 0 },
        { eventName: "UiProbeWithdraw", actionType: 1 },
      ],
    },
  );
});

test("falls back to the registry when the node rejects the replayed transaction", async (t) => {
  const posted = mockVoteScenario(t, {
    txArgs: ["\"UI Arg Probe\"", "0", "\"0xdead0001\"", '[{"eventName":"d","actionType":0}]'],
    replayFailure: "node",
  });

  const result = await castVoteOnIssueById("access-token", VOTER, ISSUE_ID);

  assert.equal(result.votedVia, "registry");
  assert.equal(posted.length, 2, "the replay was submitted and failed, then the fallback was sent");
  assert.equal(posted[1].method, "castVoteOnIssue");
});

test("refuses the fallback once this admin's vote is already recorded", async (t) => {
  const posted = mockVoteScenario(t, { votes: [{ value: VOTER.replace(/^0x/, "") }] });

  await assert.rejects(
    () => castVoteOnIssueById("access-token", VOTER, ISSUE_ID),
    /expected an array/,
    "the replay's own error must surface rather than a second vote being cast",
  );
  assert.equal(posted.length, 0);
});

test("refuses the fallback once the issue has been executed", async (t) => {
  const posted = mockVoteScenario(t, { executed: [{ issueId: ISSUE_ID, block_number: "101" }] });

  await assert.rejects(() => castVoteOnIssueById("access-token", VOTER, ISSUE_ID));
  assert.equal(posted.length, 0, "re-voting an executed issue would re-open it as new");
});

test("allows the fallback when the only execution predates this issue", async (t) => {
  const posted = mockVoteScenario(t, { executed: [{ issueId: ISSUE_ID, block_number: "99" }] });

  const result = await castVoteOnIssueById("access-token", VOTER, ISSUE_ID);

  assert.equal(result.votedVia, "registry");
  assert.equal(posted.length, 1);
});

test("refuses the fallback when the vote index cannot be read", async (t) => {
  const posted = mockVoteScenario(t, { unreadableIndex: true });

  await assert.rejects(() => castVoteOnIssueById("access-token", VOTER, ISSUE_ID));
  assert.equal(posted.length, 0, "an unreadable index is not evidence the vote is still pending");
});

test("refuses the fallback after an indeterminate transport failure", async (t) => {
  // Nothing here says the vote landed — the index is clean and no vote is recorded.
  // The submission's outcome is simply unknown, which is reason enough not to repeat it
  const posted = mockVoteScenario(t, {
    txArgs: ["\"UI Arg Probe\"", "0", "\"0xdead0001\"", '[{"eventName":"d","actionType":0}]'],
    replayFailure: "transport",
  });

  await assert.rejects(() => castVoteOnIssueById("access-token", VOTER, ISSUE_ID), /socket hang up/);
  assert.equal(posted.length, 1, "the outcome of the first submission is unknown, so it is not repeated");
});

test("reports a vote that hashed to a different issue instead of claiming success", async (t) => {
  mockVoteScenario(t, {
    txArgs: ["\"UI Arg Probe\"", "0", "\"0xdead0001\"", '[{"eventName":"d","actionType":"Deposit"}]'],
    landedIssueId: "aaaa000000000000000000000000000000000000000000000000000000000000",
  });

  await assert.rejects(
    () => castVoteOnIssueById("access-token", VOTER, ISSUE_ID),
    /landed on issue aaaa0000/,
  );
});
