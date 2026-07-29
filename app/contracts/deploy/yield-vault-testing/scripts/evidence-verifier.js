#!/usr/bin/env node
"use strict";

const axios = require("axios");
const { rest } = require("blockapps-rest");
const { config, rootNodeUrl } = require("./runtime");
const {
  bigint,
  boolean,
  field,
  normalizeAddress,
  parseJsonPreservingIntegers,
  stableJson,
} = require("./common");

const TX_HASH_RE = /^(?:0x)?[0-9a-f]{64}$/i;
const ADMIN_REGISTRY = normalizeAddress(
  process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c"
);
const ARG_ORDER = {
  pause: [],
  initializeAccrual: [],
  approve: ["spender", "value"],
  setRewardDistributor: ["newRewardDistributor"],
  setPerSecondSavingsRate: ["newRate"],
  unpause: [],
  deposit: ["assets", "receiver"],
  redeemOrQueue: ["shares", "receiver", "owner_"],
  processQueue: ["maxRequests", "maxAssets"],
  claim: ["receiver"],
  setLogicContract: ["_logicContract"],
};

function hash(value, label = "transaction hash") {
  const normalized = String(value || "").trim().replace(/^0x/i, "").toLowerCase();
  if (!TX_HASH_RE.test(normalized)) throw new Error(`${label} is malformed`);
  return normalized;
}

function transactionHashOf(value) {
  return value && field(
    value,
    ["transaction_hash", "transactionHash", "txHash", "hash"],
    null
  );
}

function receiptHashOf(receipt) {
  return hash(transactionHashOf(receipt), "receipt hash");
}

function txResultHashOf(receipt) {
  return hash(
    receipt && receipt.txResult && receipt.txResult.transactionHash,
    "receipt txResult.transactionHash"
  );
}

function unwrapQuoted(value, label) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) throw new Error(`${label} is empty`);
  const starts = text[0] === "\"" || text[0] === "'";
  const ends = text[text.length - 1] === "\"" || text[text.length - 1] === "'";
  if (starts || ends) {
    if (!starts || !ends || text[0] !== text[text.length - 1]) {
      throw new Error(`${label} has mismatched quotes`);
    }
    if (text[0] === "\"") {
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error(`${label} is not a valid quoted JSON string`);
      }
    }
    return text.slice(1, -1);
  }
  return text;
}

function decimal(value, label) {
  const unwrapped = unwrapQuoted(value, label);
  if (typeof unwrapped === "number") {
    if (!Number.isSafeInteger(unwrapped) || unwrapped < 0) {
      throw new Error(`${label} must be a non-negative safe integer`);
    }
    return String(unwrapped);
  }
  const text = String(unwrapped);
  if (!/^(?:0|[1-9]\d*)$/.test(text)) {
    throw new Error(`${label} must be a canonical non-negative decimal integer`);
  }
  return text;
}

function address(value, label) {
  return normalizeAddress(unwrapQuoted(value, label), label);
}

function text(value, label) {
  const normalized = unwrapQuoted(value, label);
  if (typeof normalized !== "string" || !normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function sourceText(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be source text`);
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {
      return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
  }
  return trimmed.startsWith("'") && trimmed.endsWith("'")
    ? trimmed.slice(1, -1)
    : value;
}

function timestamp(value, label) {
  if (value == null || value === "") throw new Error(`${label} is missing`);
  const numeric = /^\d+$/.test(String(value))
    ? Number(value) * (String(value).length <= 10 ? 1000 : 1)
    : Date.parse(String(value));
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`${label} is not a parseable positive timestamp`);
  }
  return numeric;
}

function blockNumber(value, label) {
  const parsed = bigint(value, label);
  if (parsed <= 0n) throw new Error(`${label} must be positive`);
  return parsed;
}

function optionalIndex(value, keys, label) {
  const raw = field(value, keys, null);
  if (raw == null || raw === "") return null;
  const parsed = bigint(raw, label);
  if (parsed < 0n) throw new Error(`${label} must be non-negative`);
  return parsed;
}

function orderedPoint(value, label) {
  return {
    label,
    kind: value && value.kind || "transaction",
    transactionHash: transactionHashOf(value) == null
      ? null
      : hash(transactionHashOf(value), `${label} transaction hash`),
    block: blockNumber(
      field(value, ["blockNumber", "block_number", "number"], null),
      `${label} block`
    ),
    timestamp: timestamp(
      field(value, ["timestamp", "block_timestamp", "blockTimestamp"], null),
      `${label} timestamp`
    ),
    transactionIndex: optionalIndex(
      value,
      ["transactionIndex", "transaction_index", "txIndex", "tx_index"],
      `${label} transaction index`
    ),
    eventIndex: optionalIndex(
      value,
      ["eventIndex", "event_index", "logIndex", "log_index", "index"],
      `${label} event index`
    ),
    nonce: optionalIndex(value, ["nonce", "accountSequence"], `${label} nonce`),
    signer: field(value, ["from", "signer"], null),
    capturedAt: value && value.capturedAt == null
      ? null
      : timestamp(value.capturedAt, `${label} capturedAt`),
  };
}

function dedupeOrderedPoints(points) {
  const seenTransactions = new Set();
  return points.filter((point) => {
    if (!point || !point.transactionHash) return Boolean(point);
    if (seenTransactions.has(point.transactionHash)) return false;
    seenTransactions.add(point.transactionHash);
    return true;
  });
}

function assertOrdered(points) {
  const ordered = dedupeOrderedPoints(points);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (current.block < previous.block) {
      throw new Error(`${current.label} occurs before ${previous.label}`);
    }
    if (current.block > previous.block) {
      if (current.timestamp < previous.timestamp) {
        throw new Error(`${current.label} timestamp occurs before ${previous.label}`);
      }
      continue;
    }
    if (current.kind === "snapshot") {
      if (current.capturedAt == null || current.capturedAt < current.timestamp) {
        throw new Error(`${current.label} has no valid post-block capture boundary`);
      }
      continue;
    }
    if (previous.kind === "snapshot") {
      throw new Error(`${current.label} cannot occur after ${previous.label} in the same block`);
    }
    const previousIndex = previous.eventIndex == null
      ? previous.transactionIndex
      : previous.eventIndex;
    const currentIndex = current.eventIndex == null
      ? current.transactionIndex
      : current.eventIndex;
    if (previousIndex != null && currentIndex != null && currentIndex < previousIndex) {
      throw new Error(
        `${current.label} index occurs before ${previous.label}`
      );
    }
    if (previousIndex == null && currentIndex == null &&
        previous.signer && current.signer &&
        normalizeAddress(previous.signer) === normalizeAddress(current.signer) &&
        previous.nonce != null && current.nonce != null &&
        current.nonce <= previous.nonce) {
      throw new Error(`${current.label} nonce does not follow ${previous.label}`);
    }
  }
  return true;
}

function resolveExpected(value, addresses, label) {
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "bigint" || typeof value === "number") {
    return { kind: "integer", value: decimal(value, label) };
  }
  if (typeof value === "string" && addresses[value]) {
    return { kind: "address", value: addresses[value] };
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) {
    return { kind: "integer", value };
  }
  try {
    return { kind: "address", value: normalizeAddress(value, label) };
  } catch (_) {
    return { kind: "text", value: String(value) };
  }
}

function assertArg(actual, expected, addresses, label) {
  const wanted = resolveExpected(expected, addresses, label);
  const observed = wanted.kind === "address"
    ? address(actual, label)
    : wanted.kind === "integer"
      ? decimal(actual, label)
      : wanted.kind === "boolean"
        ? boolean(unwrapQuoted(actual, label))
      : text(actual, label);
  if (observed !== wanted.value) {
    throw new Error(`${label} mismatch: expected ${wanted.value}, observed ${observed}`);
  }
}

function positionalArgs(method, argumentsObject, label) {
  const order = ARG_ORDER[method];
  if (!order) throw new Error(`${label} has no explicit argument order for ${method}`);
  const args = argumentsObject || {};
  const unexpected = Object.keys(args).filter((name) => !order.includes(name));
  if (unexpected.length || order.some((name) => args[name] == null)) {
    throw new Error(`${label} arguments do not exactly match ${order.join(",") || "(none)"}`);
  }
  return order.map((name) => args[name]);
}

function rawArgs(row, label) {
  let args = row && field(row, ["args", "arguments"], null);
  if (typeof args === "string") {
    try {
      args = parseJsonPreservingIntegers(args);
    } catch (_) {
      throw new Error(`${label} args are not valid JSON`);
    }
  }
  if (!Array.isArray(args)) throw new Error(`${label} args must be positional`);
  return args;
}

async function getRawTransaction(tokenObj, transactionHash, client = axios) {
  const expectedHash = hash(transactionHash);
  const response = await client.get(
    `${rootNodeUrl()}/strato-api/eth/v1.2/transaction`,
    {
      headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
      params: { hash: expectedHash, limit: "2" },
    }
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  if (rows.length !== 1) {
    throw new Error(`Raw transaction ${expectedHash} returned ${rows.length} rows`);
  }
  const row = rows[0];
  if (hash(transactionHashOf(row), "raw transaction hash") !== expectedHash) {
    throw new Error(`Raw transaction hash mismatch for ${expectedHash}`);
  }
  orderedPoint(row, `raw transaction ${expectedHash}`);
  return row;
}

function verifyRawCall(row, expected, addresses, label) {
  if (address(field(row, ["from", "signer"], null), `${label} signer`) !==
      addresses[expected.actor]) {
    throw new Error(`${label} signer does not match ${expected.actor}`);
  }
  const method = field(row, ["funcName", "functionName", "method"], null);
  const to = field(row, ["to", "contractAddress"], null);
  const args = rawArgs(row, label);
  const wantedArgs = positionalArgs(expected.method, expected.arguments, label);
  let observedArgs;
  if (method === expected.method &&
      address(to, `${label} target`) === expected.contractAddress) {
    observedArgs = args;
  } else {
    const contractName = text(
      field(row, ["cName", "contractName"], null),
      `${label} wrapper contract`
    );
    if (contractName !== "User" || method !== "callContract") {
      throw new Error(`${label} target or method is not the expected direct/User call`);
    }
    if (args.length < 2 ||
        address(args[0], `${label} wrapped target`) !== expected.contractAddress ||
        text(args[1], `${label} wrapped method`) !== expected.method) {
      throw new Error(`${label} User.callContract target or method mismatch`);
    }
    observedArgs = args.slice(2);
  }
  if (observedArgs.length !== wantedArgs.length) {
    throw new Error(`${label} positional argument count mismatch`);
  }
  wantedArgs.forEach((value, index) => {
    assertArg(observedArgs[index], value, addresses, `${label} argument ${index}`);
  });
  return orderedPoint(row, label);
}

function assertDeploymentPayload(payload, expected, addresses, label) {
  if (payload.contractName !== expected.contractName) {
    throw new Error(`${label} contract name mismatch`);
  }
  if (typeof expected.sourceHasher !== "function" ||
      expected.sourceHasher(payload.source) !== expected.sourceHash) {
    throw new Error(`${label} source does not match the reviewed canonical hash`);
  }
  if (payload.args.length !== expected.constructorArgs.length) {
    throw new Error(`${label} constructor argument count mismatch`);
  }
  expected.constructorArgs.forEach((value, index) => {
    const argumentLabel = `${label} constructor argument ${index}`;
    try {
      const wanted = normalizeAddress(value);
      const observedText = String(unwrapQuoted(payload.args[index], argumentLabel))
        .replace(/^0x/i, "");
      if (!/^[0-9a-f]{1,40}$/i.test(observedText) ||
          normalizeAddress(observedText.padStart(40, "0")) !== wanted) {
        throw new Error(`${argumentLabel} mismatch`);
      }
    } catch (error) {
      if (/^[0-9a-f]{40}$/i.test(String(value))) throw error;
      assertArg(payload.args[index], value, addresses, argumentLabel);
    }
  });
}

function verifyRawDeployment(row, expected, addresses, label) {
  if (address(field(row, ["from", "signer"], null), `${label} signer`) !==
      addresses[expected.actor]) {
    throw new Error(`${label} signer mismatch`);
  }
  const method = field(row, ["funcName", "functionName", "method"], null);
  const contractName = field(row, ["cName", "contractName"], null);
  const args = rawArgs(row, label);
  let payload;
  if (contractName === expected.contractName && method !== "createContract") {
    const source = field(row, ["code", "contractSrc", "source"], null);
    if (field(row, ["to", "contractAddress"], null) != null || !String(source || "").trim()) {
      throw new Error(`${label} direct deployment shape mismatch`);
    }
    payload = { contractName, source, args };
  } else if ((contractName == null || contractName === "User") &&
      method === "createContract" && args.length >= 3) {
    payload = {
      contractName: text(args[0], `${label} wrapped contract name`),
      source: sourceText(args[1], `${label} wrapped source`),
      args: args.length === 3 && Array.isArray(args[2]) ? args[2] : args.slice(2),
    };
  } else {
    throw new Error(`${label} is not a direct or User.createContract deployment`);
  }
  assertDeploymentPayload(payload, expected, addresses, label);
  return {
    shape: method === "createContract" ? "User.createContract" : "direct",
    target: method === "createContract"
      ? address(field(row, ["to", "contractAddress"], null), `${label} User target`)
      : null,
    payload,
  };
}

function eventAttributes(row) {
  let attributes = row && row.attributes;
  if (typeof attributes === "string") {
    try {
      attributes = JSON.parse(attributes);
    } catch (_) {
      attributes = null;
    }
  }
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    return attributes;
  }
  return row || {};
}

function eventIdentity(value, label) {
  const id = field(value, ["id"], null);
  const index = field(value, ["event_index", "eventIndex", "log_index", "logIndex"], null);
  if (id == null && index == null) {
    throw new Error(`${label} must include id or event_index`);
  }
  return {
    id: id == null ? null : String(id),
    index: index == null ? null : decimal(index, `${label} event_index`),
  };
}

function sameEventIdentity(row, expected, label) {
  const observed = eventIdentity(row, label);
  return (expected.id == null || observed.id === expected.id) &&
    (expected.index == null || observed.index === expected.index);
}

async function getGlobalEvents(
  tokenObj,
  expected,
  client = axios
) {
  const txHash = hash(expected.transactionHash);
  const response = await client.get(`${rootNodeUrl()}/cirrus/search/event`, {
    headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
    params: {
      transaction_hash: `eq.${txHash}`,
      address: `eq.${expected.address}`,
      event_name: `eq.${expected.eventName}`,
      order: "block_number.asc,event_index.asc,id.asc",
      limit: "100",
    },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  for (const row of rows) {
    if (hash(transactionHashOf(row), "event transaction hash") !== txHash ||
        address(row.address, "event address") !== expected.address ||
        field(row, ["event_name", "eventName", "name"], null) !== expected.eventName) {
      throw new Error(`Global event identity mismatch for ${expected.eventName} ${txHash}`);
    }
    eventIdentity(row, `${expected.eventName} live event`);
    orderedPoint(row, `${expected.eventName} event`);
  }
  return rows;
}

async function getGlobalEvent(tokenObj, expected, client = axios) {
  const wanted = eventIdentity(expected.recordedEvent || expected, `${expected.eventName} evidence`);
  const rows = await getGlobalEvents(tokenObj, expected, client);
  const matches = rows.filter((row) =>
    sameEventIdentity(row, wanted, `${expected.eventName} live event`));
  if (matches.length !== 1) {
    throw new Error(
      `Global event ${expected.eventName} ${expected.transactionHash} identity returned ` +
      `${matches.length} rows`
    );
  }
  return matches[0];
}

function compareAttributes(liveRow, recordedEvent, addresses, label) {
  const live = eventAttributes(liveRow);
  const recorded = recordedEvent.attributes;
  if (!recorded || typeof recorded !== "object" || Array.isArray(recorded) ||
      Object.keys(recorded).length === 0) {
    throw new Error(`${label} must record event attributes`);
  }
  for (const [name, value] of Object.entries(recorded)) {
    if (live[name] == null) throw new Error(`${label} live event is missing attribute ${name}`);
    assertArg(live[name], value, addresses, `${label} attribute ${name}`);
  }
}

function assertEventSemantics(eventName, row, entry, addresses, label) {
  const attrs = eventAttributes(row);
  const args = entry.arguments || {};
  const actor = addresses[entry.actor];
  const required = {
    Approval: { owner: actor, spender: args.spender, value: args.value },
    Paused: { account: entry.governanceIssueId ? addresses.VAULT_OWNER : actor },
    Unpaused: { account: entry.governanceIssueId ? addresses.VAULT_OWNER : actor },
    AccrualInitialized: { perSecondSavingsRate: "1000000000000000000000000000" },
    RewardDistributorUpdated: { newDistributor: args.newRewardDistributor },
    PerSecondSavingsRateUpdated: { newRate: args.newRate },
    Deposit: { caller: actor, owner: args.receiver, assets: args.assets },
    WithdrawalRequested: { owner: args.owner_, receiver: args.receiver, shares: args.shares },
    WithdrawalClaimed: { owner: actor, receiver: args.receiver },
  }[eventName] || {};
  for (const [name, value] of Object.entries(required)) {
    if (attrs[name] == null) throw new Error(`${label} is missing required attribute ${name}`);
    assertArg(attrs[name], value, addresses, `${label} attribute ${name}`);
  }
  for (const name of {
    AccrualInitialized: ["lastAccrual"],
    Deposit: ["shares"],
    WithdrawalRequested: ["requestId"],
    QueueProcessed: [
      "requestId", "owner", "sharesBurned", "assetsReserved", "fullyProcessed",
    ],
    WithdrawalClaimed: ["assets"],
    Transfer: ["from", "to", "value"],
  }[eventName] || []) {
    if (attrs[name] == null) throw new Error(`${label} is missing required attribute ${name}`);
    if (["lastAccrual", "shares", "requestId", "sharesBurned", "assetsReserved", "assets", "value"]
      .includes(name) && bigint(attrs[name], `${label} ${name}`) <= 0n) {
      throw new Error(`${label} attribute ${name} must be positive`);
    }
  }
}

function validateReceipt(receipt, expectedHash, expectedSuccess, label) {
  const normalizedHash = hash(expectedHash);
  if (receiptHashOf(receipt) !== normalizedHash ||
      txResultHashOf(receipt) !== normalizedHash) {
    throw new Error(`${label} receipt hash does not match`);
  }
  const succeeded = receipt && receipt.status === "Success";
  if (succeeded !== expectedSuccess) {
    throw new Error(`${label} expected success=${expectedSuccess}, observed ${succeeded}`);
  }
  return true;
}

async function validateTargetEvents(
  tokenObj,
  entry,
  expected,
  addresses,
  readEvent = getGlobalEvent
) {
  const transactionHash = hash(
    entry.executionTransactionHash || entry.transactionHash,
    `${expected.name} transaction hash`
  );
  const liveEvents = [];
  for (const recordedEvent of entry.events || []) {
    const eventName = field(recordedEvent, ["eventName", "event_name", "name"], null);
    const eventAddress = address(
      recordedEvent.contractAddress || entry.contractAddress,
      `${expected.name} ${eventName} contractAddress`
    );
    if (hash(transactionHashOf(recordedEvent), `${eventName} recorded hash`) !== transactionHash) {
      throw new Error(`${expected.name} ${eventName} recorded hash mismatch`);
    }
    eventIdentity(recordedEvent, `${expected.name} recorded ${eventName}`);
    const live = await readEvent(tokenObj, {
      transactionHash,
      address: eventAddress,
      eventName,
      recordedEvent,
    });
    compareAttributes(live, recordedEvent, addresses, `${expected.name} ${eventName}`);
    assertEventSemantics(eventName, live, entry, addresses, `${expected.name} ${eventName}`);
    liveEvents.push(live);
  }
  if (expected.event &&
      !liveEvents.some((event) =>
        field(event, ["event_name", "eventName", "name"], null) === expected.event)) {
    throw new Error(`${expected.name} is missing ${expected.event}`);
  }
  if (expected.method === "processQueue") {
    const queueEvents = liveEvents.filter((event) =>
      field(event, ["event_name", "eventName", "name"], null) === "QueueProcessed");
    if (queueEvents.length !== 3) {
      throw new Error(`${expected.name} must prove exactly three QueueProcessed events`);
    }
    let priorRequestId = 0n;
    let priorEventIndex = -1n;
    for (const [index, event] of queueEvents.entries()) {
      const identity = eventIdentity(event, `${expected.name} QueueProcessed ${index + 1}`);
      if (identity.index == null) {
        throw new Error(`${expected.name} QueueProcessed events require event_index`);
      }
      const ordering = BigInt(identity.index);
      const attrs = eventAttributes(event);
      const requestId = bigint(attrs.requestId, `${expected.name} requestId`);
      if (ordering <= priorEventIndex || requestId <= priorRequestId ||
          !boolean(attrs.fullyProcessed)) {
        throw new Error(`${expected.name} QueueProcessed events are not complete and ordered`);
      }
      priorEventIndex = ordering;
      priorRequestId = requestId;
    }
  }
  return liveEvents;
}

async function validateTransactionEvidence(
  tokenObj,
  entry,
  expected,
  addresses,
  dependencies = {}
) {
  const readRaw = dependencies.readRaw || getRawTransaction;
  const readReceipt = dependencies.readReceipt || (async (token, txHash) => {
    const response = await rest.getBlocResults(
      token,
      [txHash],
      { config, isAsync: true }
    );
    return Array.isArray(response) ? response[0] : response;
  });
  const readEvent = dependencies.readEvent || getGlobalEvent;
  const transactionHash = hash(
    entry.executionTransactionHash || entry.transactionHash,
    `${expected.name} transaction hash`
  );
  const expectedCall = {
    ...expected,
    arguments: entry.arguments || {},
    contractAddress: addresses[expected.contractRole],
  };
  const raw = await readRaw(tokenObj, transactionHash);
  const point = verifyRawCall(raw, expectedCall, addresses, expected.name);
  const recordedReceipt = entry.executionReceipt || entry.receipt;
  validateReceipt(recordedReceipt, transactionHash, expected.success, expected.name);
  const liveReceipt = await readReceipt(tokenObj, transactionHash);
  validateReceipt(liveReceipt, transactionHash, expected.success, `live ${expected.name}`);
  if (stableJson(liveReceipt.status) !== stableJson(recordedReceipt.status)) {
    throw new Error(`Live receipt status mismatch for ${expected.name}`);
  }
  const liveEvents = await validateTargetEvents(
    tokenObj,
    entry,
    expected,
    addresses,
    readEvent
  );
  return { transactionHash, raw, receipt: liveReceipt, events: liveEvents, point };
}

function issueFields(row, label) {
  const attrs = eventAttributes(row);
  let args = attrs.args;
  if (typeof args === "string") {
    try {
      args = parseJsonPreservingIntegers(args);
    } catch (_) {
      throw new Error(`${label} args are not valid JSON`);
    }
  }
  if (!Array.isArray(args)) throw new Error(`${label} args must be positional`);
  return {
    issueId: text(field(attrs, ["issueId", "issue_id"], null), `${label} issueId`),
    target: address(attrs.target, `${label} target`),
    func: text(attrs.func, `${label} func`),
    args,
    sender: attrs.sender == null ? null : address(attrs.sender, `${label} sender`),
    executor: attrs.executor == null ? null : address(attrs.executor, `${label} executor`),
  };
}

function logicalPayload(row, label) {
  const method = text(
    field(row, ["funcName", "functionName", "method"], null),
    `${label} method`
  );
  const args = rawArgs(row, label);
  if (field(row, ["cName", "contractName"], null) === "User" &&
      method === "callContract") {
    if (args.length < 2) throw new Error(`${label} User.callContract payload is incomplete`);
    return {
      target: address(args[0], `${label} wrapped target`),
      func: text(args[1], `${label} wrapped method`),
      args: args.slice(2),
    };
  }
  return {
    target: address(field(row, ["to", "contractAddress"], null), `${label} target`),
    func: method,
    args,
  };
}

function canonicalArg(value, label) {
  const unwrapped = unwrapQuoted(value, label);
  if (Array.isArray(unwrapped)) {
    return `array:${stableJson(unwrapped.map((item, index) =>
      canonicalArg(item, `${label}[${index}]`)))}`;
  }
  if (unwrapped && typeof unwrapped === "object") {
    throw new Error(`${label} must not be an object`);
  }
  if (typeof unwrapped === "boolean") return `bool:${unwrapped}`;
  try {
    return `address:${normalizeAddress(unwrapped, label)}`;
  } catch (_) {
    if (typeof unwrapped === "number" || /^(?:0|[1-9]\d*)$/.test(String(unwrapped))) {
      return `integer:${decimal(unwrapped, label)}`;
    }
    return `text:${text(unwrapped, label)}`;
  }
}

function payloadMatchesIssue(payload, issue, label) {
  if (payload.target !== issue.target || payload.func !== issue.func ||
      payload.args.length !== issue.args.length) {
    return false;
  }
  return payload.args.every((value, index) =>
    canonicalArg(value, `${label} raw arg ${index}`) ===
      canonicalArg(issue.args[index], `${label} issue arg ${index}`));
}

function bindRawToIssue(row, issue, label, options = {}) {
  const logical = logicalPayload(row, label);
  if (logical.func === "castVoteOnIssue") {
    if (!options.allowCastVoteOnIssue) {
      throw new Error(`${label} must not call AdminRegistry.castVoteOnIssue`);
    }
    if (logical.target !== ADMIN_REGISTRY ||
        logical.args.length !== issue.args.length + 2 ||
        address(logical.args[0], `${label} vote target`) !== issue.target ||
        text(logical.args[1], `${label} vote function`) !== issue.func ||
        !logical.args.slice(2).every((value, index) =>
          canonicalArg(value, `${label} vote arg ${index}`) ===
            canonicalArg(issue.args[index], `${label} issue arg ${index}`))) {
      throw new Error(`${label} AdminRegistry vote does not exactly bind to the governance issue`);
    }
    return "registry-vote";
  }
  if (!payloadMatchesIssue(logical, issue, label)) {
    throw new Error(`${label} does not exactly bind to the governance issue`);
  }
  return "logical";
}

function assertApprovalEvidence(
  operation,
  executionHash,
  executionRaw,
  submissionSigner,
  expected,
  addresses
) {
  const approval = operation.governanceApproval;
  if (!approval ||
      hash(approval.transactionHash, `${expected.name} approval hash`) !== executionHash) {
    throw new Error(`${expected.name} must record the exact APPROVER transaction`);
  }
  const signer = address(
    field(executionRaw, ["from", "signer"], null),
    `${expected.name} approval signer`
  );
  const allowedAdmins = new Set([addresses.OWNER, addresses.APPROVER]);
  if (signer === submissionSigner ||
      (expected.adminOrderIndependent === true
        ? !allowedAdmins.has(signer)
        : signer !== addresses.APPROVER)) {
    throw new Error(`${expected.name} approval signer separation is invalid`);
  }
  if (!approval.approver ||
      address(approval.approver.address, `${expected.name} recorded approver`) !== signer) {
    throw new Error(`${expected.name} recorded APPROVER does not match raw signer`);
  }
}

function assertIssueCall(issue, expected, addresses, label) {
  if (expected.issueOnly) {
    if (issue.target !== expected.issueOnly.target ||
        issue.func !== expected.issueOnly.func) {
      throw new Error(`${label} target or function mismatch`);
    }
    if (expected.issueOnly.deployment) {
      if (issue.args.length !== 3 || !Array.isArray(issue.args[2])) {
        throw new Error(`${label} deployment payload must contain nested constructor arguments`);
      }
      assertDeploymentPayload({
        contractName: text(issue.args[0], `${label} contract name`),
        source: sourceText(issue.args[1], `${label} source`),
        args: issue.args[2],
      }, expected.issueOnly.deployment, addresses, label);
    } else if (expected.issueOnly.firstArgument != null) {
      assertArg(
        issue.args[0],
        expected.issueOnly.firstArgument,
        addresses,
        `${label} first argument`
      );
    }
    return;
  }
  if (issue.target !== expected.contractAddress || issue.func !== expected.method) {
    throw new Error(`${label} target or function mismatch`);
  }
  const wanted = positionalArgs(expected.method, expected.arguments, label);
  if (issue.args.length !== wanted.length) throw new Error(`${label} argument count mismatch`);
  wanted.forEach((value, index) =>
    assertArg(issue.args[index], value, addresses, `${label} argument ${index}`));
}

async function validateGovernedOperation(
  tokenObj,
  operation,
  expected,
  addresses,
  dependencies = {}
) {
  const readRaw = dependencies.readRaw || getRawTransaction;
  const readEvent = dependencies.readEvent || getGlobalEvent;
  const readReceipt = dependencies.readReceipt || (async (token, txHash) => {
    const response = await rest.getBlocResults(token, [txHash], { config, isAsync: true });
    return Array.isArray(response) ? response[0] : response;
  });
  const submissionHash = hash(operation.transactionHash, `${expected.name} submission hash`);
  const executionHash = hash(
    operation.governanceExecution && operation.governanceExecution.transactionHash,
    `${expected.name} execution hash`
  );
  const submissionRaw = await readRaw(tokenObj, submissionHash);
  const submissionSigner = address(
    field(submissionRaw, ["from", "signer"], null),
    "governed signer"
  );
  if (expected.adminOrderIndependent === true
    ? !new Set([addresses.OWNER, addresses.APPROVER]).has(submissionSigner)
    : submissionSigner !== addresses[expected.actor]) {
    throw new Error(`${expected.name} submission signer mismatch`);
  }
  validateReceipt(operation.receipt, submissionHash, true, `${expected.name} submission`);
  const liveSubmissionReceipt = await readReceipt(tokenObj, submissionHash);
  validateReceipt(
    liveSubmissionReceipt,
    submissionHash,
    true,
    `live ${expected.name} submission`
  );
  eventIdentity(operation.governanceIssueCreatedEvent, `${expected.name} recorded IssueCreated`);
  const issueCreated = await readEvent(tokenObj, {
    transactionHash: submissionHash,
    address: ADMIN_REGISTRY,
    eventName: "IssueCreated",
    recordedEvent: operation.governanceIssueCreatedEvent,
  });
  const created = issueFields(issueCreated, `${expected.name} IssueCreated`);
  const expectedCall = {
    ...expected,
    arguments: operation.arguments || expected.arguments || {},
    contractAddress: addresses[expected.contractRole],
  };
  if (expected.issueOnly && expected.issueOnly.deployment) {
    const deployment = verifyRawDeployment(
      submissionRaw,
      {
        ...expected.issueOnly.deployment,
        actor: expected.actor,
      },
      addresses,
      `${expected.name} raw submission`
    );
    if (operation.governanceIssueTarget == null ||
        address(operation.governanceIssueTarget, `${expected.name} recorded governance target`) !==
          deployment.target) {
      throw new Error(`${expected.name} governance target does not match raw User target`);
    }
    const rawGovernance = {
      target: deployment.target,
      func: "createContract",
      args: [
        deployment.payload.contractName,
        deployment.payload.source,
        deployment.payload.args,
      ],
    };
    const recordedGovernance = {
      target: deployment.target,
      func: text(
        operation.governanceIssueFunction,
        `${expected.name} recorded governance function`
      ),
      args: operation.governanceIssueArguments,
    };
    if (!Array.isArray(recordedGovernance.args) ||
        !payloadMatchesIssue(
          rawGovernance,
          recordedGovernance,
          `${expected.name} recorded governance payload`
        ) ||
        !operation.governancePayload ||
        !payloadMatchesIssue(
          rawGovernance,
          operation.governancePayload,
          `${expected.name} persisted governance payload`
        )) {
      throw new Error(`${expected.name} recorded governance payload does not match raw submission`);
    }
    expectedCall.issueOnly = {
      ...expected.issueOnly,
      target: deployment.target,
    };
  }
  assertIssueCall(created, expectedCall, addresses, `${expected.name} IssueCreated`);
  if (created.issueId !== String(operation.governanceIssueId)) {
    throw new Error(`${expected.name} IssueCreated issueId mismatch`);
  }
  const submissionShape = expected.issueOnly && expected.issueOnly.deployment
    ? "deployment"
    : bindRawToIssue(
        submissionRaw,
        created,
        `${expected.name} raw submission`,
        expected
      );
  const recordedExecuted = operation.governanceExecution &&
    operation.governanceExecution.row;
  eventIdentity(recordedExecuted, `${expected.name} recorded IssueExecuted`);
  const issueExecuted = await readEvent(tokenObj, {
    transactionHash: executionHash,
    address: ADMIN_REGISTRY,
    eventName: "IssueExecuted",
    recordedEvent: recordedExecuted,
  });
  const executed = issueFields(issueExecuted, `${expected.name} IssueExecuted`);
  if (executed.issueId !== created.issueId ||
      executed.target !== created.target ||
      executed.func !== created.func ||
      stableJson(executed.args.map((value, index) =>
        canonicalArg(value, `${expected.name} executed arg ${index}`))) !==
      stableJson(created.args.map((value, index) =>
        canonicalArg(value, `${expected.name} created arg ${index}`)))) {
    throw new Error(`${expected.name} IssueExecuted does not match IssueCreated`);
  }
  const executionRaw = await readRaw(tokenObj, executionHash);
  assertApprovalEvidence(
    operation,
    executionHash,
    executionRaw,
    submissionSigner,
    expected,
    addresses
  );
  let executionShape;
  if (expected.issueOnly && expected.issueOnly.deployment) {
    verifyRawDeployment(
      executionRaw,
      {
        ...expected.issueOnly.deployment,
        actor: "APPROVER",
      },
      addresses,
      `${expected.name} raw execution`
    );
    executionShape = "deployment";
  } else {
    executionShape = bindRawToIssue(
      executionRaw,
      executed,
      `${expected.name} raw execution`,
      expected
    );
  }
  const recordedReceipt = operation.governanceExecutionReceipt;
  validateReceipt(recordedReceipt, executionHash, true, `${expected.name} execution`);
  const liveReceipt = await readReceipt(tokenObj, executionHash);
  validateReceipt(liveReceipt, executionHash, true, `live ${expected.name} execution`);
  return {
    submissionHash,
    executionHash,
    issueId: created.issueId,
    submissionShape,
    executionShape,
    submissionPoint: orderedPoint(submissionRaw, `${expected.name} submission`),
    executionPoint: orderedPoint(executionRaw, `${expected.name} execution`),
    issueCreated,
    issueExecuted,
    submissionReceipt: liveSubmissionReceipt,
    receipt: liveReceipt,
  };
}

async function validateFailedGovernedExecution(
  tokenObj,
  operation,
  expected,
  addresses,
  dependencies = {}
) {
  const readRaw = dependencies.readRaw || getRawTransaction;
  const readEvent = dependencies.readEvent || getGlobalEvent;
  const readReceipt = dependencies.readReceipt || (async (token, txHash) => {
    const response = await rest.getBlocResults(token, [txHash], { config, isAsync: true });
    return Array.isArray(response) ? response[0] : response;
  });
  const submissionHash = hash(operation.transactionHash, `${expected.name} submission hash`);
  const executionHash = hash(
    operation.executionTransactionHash ||
      operation.governanceExecution && operation.governanceExecution.transactionHash,
    `${expected.name} failed execution hash`
  );
  const submissionRaw = await readRaw(tokenObj, submissionHash);
  const submissionSigner = address(
    field(submissionRaw, ["from", "signer"], null),
    "governed signer"
  );
  if (expected.adminOrderIndependent === true
    ? !new Set([addresses.OWNER, addresses.APPROVER]).has(submissionSigner)
    : submissionSigner !== addresses[expected.actor]) {
    throw new Error(`${expected.name} submission signer mismatch`);
  }
  validateReceipt(operation.receipt, submissionHash, true, `${expected.name} submission`);
  validateReceipt(
    await readReceipt(tokenObj, submissionHash),
    submissionHash,
    true,
    `live ${expected.name} submission`
  );
  eventIdentity(operation.governanceIssueCreatedEvent, `${expected.name} recorded IssueCreated`);
  const issueCreated = await readEvent(tokenObj, {
    transactionHash: submissionHash,
    address: ADMIN_REGISTRY,
    eventName: "IssueCreated",
    recordedEvent: operation.governanceIssueCreatedEvent,
  });
  const created = issueFields(issueCreated, `${expected.name} IssueCreated`);
  const expectedCall = {
    ...expected,
    arguments: operation.arguments || expected.arguments || {},
    contractAddress: addresses[expected.contractRole],
  };
  assertIssueCall(created, expectedCall, addresses, `${expected.name} IssueCreated`);
  if (created.issueId !== String(operation.governanceIssueId)) {
    throw new Error(`${expected.name} IssueCreated issueId mismatch`);
  }
  bindRawToIssue(submissionRaw, created, `${expected.name} raw submission`, expected);
  const executionRaw = await readRaw(tokenObj, executionHash);
  assertApprovalEvidence(
    operation,
    executionHash,
    executionRaw,
    submissionSigner,
    expected,
    addresses
  );
  bindRawToIssue(executionRaw, created, `${expected.name} failed raw execution`, expected);
  const recordedReceipt = operation.executionReceipt ||
    operation.governanceExecutionReceipt;
  validateReceipt(recordedReceipt, executionHash, false, `${expected.name} failed execution`);
  const liveReceipt = await readReceipt(tokenObj, executionHash);
  validateReceipt(liveReceipt, executionHash, false, `live ${expected.name} failed execution`);
  return {
    submissionHash,
    executionHash,
    issueId: created.issueId,
    submissionPoint: orderedPoint(submissionRaw, `${expected.name} submission`),
    executionPoint: orderedPoint(executionRaw, `${expected.name} failed execution`),
    point: orderedPoint(executionRaw, `${expected.name} failed execution`),
    issueCreated,
    submissionReceipt: operation.receipt,
    receipt: liveReceipt,
    failedDuringGovernanceExecution: true,
  };
}

module.exports = {
  ADMIN_REGISTRY,
  ARG_ORDER,
  TX_HASH_RE,
  assertOrdered,
  dedupeOrderedPoints,
  decimal,
  eventIdentity,
  getGlobalEvent,
  getGlobalEvents,
  getRawTransaction,
  hash,
  orderedPoint,
  positionalArgs,
  validateGovernedOperation,
  validateFailedGovernedExecution,
  validateReceipt,
  validateTargetEvents,
  validateTransactionEvidence,
  verifyRawCall,
  verifyRawDeployment,
};
