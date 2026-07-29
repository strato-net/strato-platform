"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// runtime must load the YieldVault-local environment before shared config.
const runtime = require("./runtime");
const auth = require("../../auth");
const axios = require("axios");
const { importer, rest } = require("blockapps-rest");
const {
  atomicWrite,
  bigint,
  boolean,
  externalGovernanceExecutionReconciliation,
  field,
  hashValue,
  jsonValue,
  lookupRawSubmission,
  mappingValue,
  normalizeAddress,
  parseJsonPreservingIntegers,
  readAccountSubmissionState,
  readVaultSnapshot,
  sameTransactionHash,
  stableJson,
} = require("./common");
const {
  assertMarkedOnlyOwner,
  registeredCheckpoint,
} = require("./only-owner-registry");

const DEAD_BEEF = "deadbeef";
const ZERO_ADDRESS = "0".repeat(40);
const TX_HASH_RE = /^(?:0x)?[0-9a-f]{64}$/i;
const SOURCE_HASH_RE = /^[0-9a-f]{64}$/i;
const DEFAULT_DEADLINE_MS = 60_000;
const DEFAULT_POLL_MS = Number(process.env.YIELD_VAULT_POLL_INTERVAL_MS || 2_000);
const ADMIN_REGISTRY = normalizeAddress(
  process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c"
);
const APPENDED_VAULT_FIELDS = [
  "accrualInitialized",
  "perSecondSavingsRate",
  "lastAccrual",
  "rewardDistributor",
  "accountedAssets",
];

class WorkflowStop extends Error {
  constructor(checkpoint, reason, transactionHash, details) {
    super(`${checkpoint} stopped: ${reason}`);
    this.checkpoint = checkpoint;
    this.reason = reason;
    this.transactionHash = transactionHash || null;
    this.details = jsonValue(details || null);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function submittedSourceHash(value) {
  return sha256(String(value));
}

function stripComments(source) {
  let output = source.replace(/\/\*[\s\S]*?\*\//g, "");
  output = output.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) {
      return trimmed.includes("SPDX-License-Identifier") ? line : "";
    }
    return line.replace(/\/\/.*$/, "");
  }).join("\n");
  return output;
}

function combinedSourceText(value) {
  if (Buffer.isBuffer(value)) return stripComments(value.toString());
  if (typeof value === "string") return stripComments(value);
  if (value && typeof value === "object") {
    return Object.keys(value).map((key) => {
      const content = String(value[key]).replace(/^.*?\.sol,\s*/i, "");
      return stripComments(content);
    }).join("\n");
  }
  return stripComments(String(value));
}

async function combineReviewedSource(filePath, combine = importer.combine) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error(`Reviewed source does not exist: ${absolute}`);
  const source = combinedSourceText(await combine(absolute));
  return {
    path: absolute,
    source,
    combinedSourceHash: sha256(source),
  };
}

function requireSourceHash(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SOURCE_HASH_RE.test(normalized)) {
    throw new Error(`${label} must be an exact 64-character SHA-256 hash`);
  }
  return normalized;
}

function verifyReviewedSource(source, expected, label) {
  const expectedHash = requireSourceHash(expected, label);
  if (source.combinedSourceHash !== expectedHash) {
    throw new Error(
      `${label} mismatch: combined=${source.combinedSourceHash} expected=${expectedHash}`
    );
  }
  return {
    file: source.path,
    combinedSourceHash: source.combinedSourceHash,
    expectedReviewedSourceHash: expectedHash,
    matched: true,
  };
}

function parseArgs(argv, flags = []) {
  const parsed = {};
  const allowedFlags = new Set(flags);
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (allowedFlags.has(key)) {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    parsed[key] = value;
    index++;
  }
  return parsed;
}

function requireArguments(args, names) {
  const missing = names.filter((name) => !args[name]);
  if (missing.length) {
    throw new Error(`Missing arguments: ${missing.map((name) => `--${name}`).join(", ")}`);
  }
}

function requireOnlyArguments(args, names) {
  const allowed = new Set(names);
  const unexpected = Object.keys(args).filter((name) => !allowed.has(name));
  if (unexpected.length) {
    throw new Error(`Unsupported arguments: ${unexpected.map((name) => `--${name}`).join(", ")}`);
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

class PathLock {
  constructor(targetPath) {
    this.path = `${path.resolve(targetPath)}.lock`;
    this.fd = null;
    this.owner = null;
  }

  acquire() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    for (;;) {
      const owner = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
      try {
        this.fd = fs.openSync(this.path, "wx", 0o600);
        this.owner = owner;
        fs.writeFileSync(this.fd, `${owner}\n`);
        fs.fsyncSync(this.fd);
        fsyncDirectory(path.dirname(this.path));
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const observed = fs.readFileSync(this.path, "utf8").trim();
        const pid = Number(observed.split(":")[0]);
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            throw new Error(`Artifact is locked by process ${pid}: ${this.path}`);
          } catch (pidError) {
            if (pidError.code !== "ESRCH") throw pidError;
          }
        }
        const stale = `${this.path}.stale.${process.pid}.${crypto.randomBytes(8).toString("hex")}`;
        try {
          fs.renameSync(this.path, stale);
          fs.unlinkSync(stale);
        } catch (renameError) {
          if (renameError.code !== "ENOENT") throw renameError;
        }
      }
    }
  }

  release() {
    if (this.fd == null) return;
    fs.closeSync(this.fd);
    this.fd = null;
    try {
      const observed = fs.readFileSync(this.path, "utf8").trim();
      if (observed !== this.owner) throw new Error(`Lock ownership changed: ${this.path}`);
      fs.unlinkSync(this.path);
      fsyncDirectory(path.dirname(this.path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      this.owner = null;
    }
  }
}

class WorkflowJournal {
  constructor(journalPath, evidencePath, metadata) {
    this.path = path.resolve(journalPath);
    this.evidencePath = path.resolve(evidencePath);
    if (this.path === this.evidencePath) {
      throw new Error("Run-state and evidence paths must be different");
    }
    this.metadata = jsonValue(metadata);
    this.locks = [this.path, this.evidencePath]
      .sort()
      .map((target) => new PathLock(target));
    this.state = null;
  }

  acquire() {
    try {
      for (const lock of this.locks) lock.acquire();
      if (fs.existsSync(this.path)) {
        this.state = JSON.parse(fs.readFileSync(this.path, "utf8"));
        if (this.state.configurationHash !== this.metadata.configurationHash) {
          const previous = JSON.parse(stableJson(this.state.configuration || {}));
          const current = JSON.parse(stableJson(this.metadata.configuration || {}));
          delete previous.workflowCodeHash;
          delete current.workflowCodeHash;
          const pending = Object.values(this.state.checkpoints || {}).filter((entry) =>
            entry && entry.status === "submitted" &&
            entry.governanceIssueId &&
            entry.governanceIssueCreatedEvent);
          if (pending.length !== 1 || stableJson(previous) !== stableJson(current)) {
            throw new Error("Existing run-state configuration does not match this invocation");
          }
          const migration = {
            type: pending[0].governanceApproval
              ? "workflow-code-resume"
              : "automatic-governance-approver",
            checkpointId: pending[0].checkpointId,
            previousConfigurationHash: this.state.configurationHash,
            previousWorkflowCodeHash:
              this.state.configuration && this.state.configuration.workflowCodeHash,
            migratedAt: new Date().toISOString(),
          };
          if (pending[0].governanceApproval) {
            this.state.workflowCodeMigration = migration;
          } else {
            this.state.automaticApprovalMigration = migration;
          }
          this.state.configurationHash = this.metadata.configurationHash;
          this.state.configuration = this.metadata.configuration;
        }
      } else {
        this.state = {
          schemaVersion: 1,
          createdAt: new Date().toISOString(),
          checkpoints: {},
          interruptions: [],
          ...this.metadata,
        };
      }
      this.save();
    } catch (error) {
      this.release();
      throw error;
    }
  }

  release() {
    for (const lock of [...this.locks].reverse()) lock.release();
  }

  evidence() {
    const evidence = {
      ...this.state.evidence,
      completed: this.state.completed === true,
      updatedAt: this.state.updatedAt,
      operations: this.state.checkpoints,
      runState: {
        path: this.path,
        configurationHash: this.state.configurationHash,
      },
    };
    return jsonValue(evidence);
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    atomicWrite(this.path, this.state);
    atomicWrite(this.evidencePath, this.evidence());
  }

  updateEvidence(value) {
    this.state.evidence = { ...(this.state.evidence || {}), ...jsonValue(value) };
    this.save();
  }

  transition(id, status, details = {}) {
    this.state.checkpoints[id] = {
      ...(this.state.checkpoints[id] || {}),
      ...jsonValue(details),
      checkpointId: id,
      status,
      [`${status}At`]: new Date().toISOString(),
    };
    this.save();
    return this.state.checkpoints[id];
  }

  interrupt(error) {
    this.state.interruptions.push({
      checkpointId: error.checkpoint,
      reason: error.reason,
      transactionHash: error.transactionHash,
      details: error.details,
      at: new Date().toISOString(),
    });
    this.save();
  }
}

function transactionHash(value) {
  const values = Array.isArray(value) ? value : [value];
  const candidates = [];
  for (const item of values) {
    if (!item || typeof item !== "object") continue;
    candidates.push(
      item.hash,
      item.transactionHash,
      item.transaction_hash,
      item.txHash,
      item.txResult && item.txResult.transactionHash
    );
  }
  const match = candidates.find((candidate) => TX_HASH_RE.test(String(candidate || "")));
  return match ? String(match).replace(/^0x/, "").toLowerCase() : null;
}

function submissionSequence(value) {
  const seen = new Set();
  function visit(candidate, depth) {
    if (!candidate || typeof candidate !== "object" || depth > 6 || seen.has(candidate)) {
      return null;
    }
    seen.add(candidate);
    for (const key of ["nonce", "accountSequence", "sequenceNumber", "account_sequence"]) {
      if (candidate[key] != null && /^\d+$/.test(String(candidate[key]))) {
        return String(candidate[key]);
      }
    }
    for (const nested of Object.values(candidate)) {
      const found = visit(nested, depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  return visit(value, 0);
}

function nestedValues(value, depth = 0, seen = new Set()) {
  if (value == null || depth > 7) return [];
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item) => nestedValues(item, depth + 1, seen));
  }
  return Object.values(value).flatMap((item) => nestedValues(item, depth + 1, seen));
}

function createdAddress(receipt) {
  const preferred = [
    receipt && receipt.txResult && receipt.txResult.contractsCreated,
    receipt && receipt.contractsCreated,
  ];
  for (const candidate of preferred.flatMap((value) => nestedValues(value))) {
    try {
      return normalizeAddress(candidate, "receipt-created address");
    } catch (_) {
      // Continue through supported response shapes.
    }
  }
  for (const candidate of nestedValues([
    receipt && receipt.txResult && receipt.txResult.response,
    receipt && receipt.data && receipt.data.contents,
    receipt && receipt.response,
  ])) {
    try {
      return normalizeAddress(candidate, "receipt-created address");
    } catch (_) {
      // Continue through supported response shapes.
    }
  }
  return null;
}

function issueId(value) {
  const values = Array.isArray(value) ? value : [value];
  const candidates = values.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object") return [];
    const contents = item.data && item.data.contents;
    if (contents && typeof contents === "object" && !Array.isArray(contents)) return [];
    return [
      item.issueId,
      item.issue_id,
      item.txResult && item.txResult.response && item.txResult.response.v,
      typeof contents === "string" ? contents : null,
      ...(Array.isArray(contents) && contents.length === 1 &&
          typeof contents[0] === "string"
        ? contents
        : []),
    ];
  });
  return candidates.find((candidate) => {
    if (typeof candidate !== "string" || !candidate.trim()) return false;
    try {
      normalizeAddress(candidate);
      return false;
    } catch (_) {
      return true;
    }
  }) || null;
}

function receiptFrom(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.find((item) => item && typeof item === "object" && item.status) || null;
}

function ensureDeadline(deadline, checkpoint) {
  if (Date.now() >= deadline) {
    throw new WorkflowStop(checkpoint, "timeout", null, { deadline });
  }
}

async function pollReceipt(tokenObj, hash, deadline, dependencies, onPoll) {
  let latest = null;
  while (Date.now() < deadline) {
    const response = await dependencies.rest.getBlocResults(
      tokenObj,
      [hash],
      { config: runtime.config, isAsync: true }
    );
    latest = receiptFrom(response);
    if (onPoll) onPoll(latest);
    if (latest && latest.status && latest.status !== "Pending") return latest;
    await dependencies.sleep(Math.min(dependencies.pollMs, Math.max(1, deadline - Date.now())));
  }
  return latest;
}

function eventTransactionHash(row) {
  return transactionHash({
    hash: field(row, ["transaction_hash", "transactionHash", "txHash"], null),
  });
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
  return attributes && typeof attributes === "object" ? attributes : row || {};
}

function governanceArgs(row) {
  let args = field(eventAttributes(row), ["args"], []);
  if (typeof args === "string") {
    try {
      args = parseJsonPreservingIntegers(args);
    } catch (_) {
      return null;
    }
  }
  return Array.isArray(args) ? args : null;
}

function canonicalOperationArg(value) {
  if (Array.isArray(value)) {
    return `array:${stableJson(value.map((item) => canonicalOperationArg(item)))}`;
  }
  if (value && typeof value === "object") return "invalid-object";
  let text = String(value);
  if (text.startsWith("\"") && text.endsWith("\"")) {
    try {
      text = JSON.parse(text);
    } catch (_) {
      return `invalid-quoted-value:${text}`;
    }
  } else if (text.startsWith("'") && text.endsWith("'")) {
    text = text.slice(1, -1);
  }
  if (["true", "false"].includes(text.toLowerCase())) {
    return `bool:${text.toLowerCase()}`;
  }
  try {
    return `address:${normalizeAddress(text)}`;
  } catch (_) {
    return `value:${text}`;
  }
}

function decodedSourceText(value) {
  const text = String(value);
  if (text.startsWith("\"") && text.endsWith("\"")) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return text.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
  }
  return text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text;
}

function governanceEventMatches(row, expected) {
  if (!expected) return true;
  const attrs = eventAttributes(row);
  const args = governanceArgs(row);
  return normalizeAddress(attrs.target, "governance target") === expected.target &&
    String(attrs.func) === expected.func &&
    args && args.length === expected.args.length &&
    args.every((value, index) =>
      canonicalOperationArg(value) === canonicalOperationArg(expected.args[index]));
}

function eventPosition(row, label) {
  const block = bigint(field(row, ["block_number", "blockNumber"], null), `${label} block`);
  const timestamp = Date.parse(field(row, ["block_timestamp", "blockTimestamp"], null));
  if (!Number.isSafeInteger(timestamp)) throw new Error(`${label} timestamp is invalid`);
  const eventIndexValue = field(row, ["event_index", "eventIndex", "id"], null);
  return {
    block,
    timestamp,
    eventIndex: eventIndexValue == null || !/^\d+$/.test(String(eventIndexValue))
      ? null
      : bigint(eventIndexValue),
    transactionHash: eventTransactionHash(row),
  };
}

function eventIsAfter(createdRow, executedRow) {
  const created = eventPosition(createdRow, "IssueCreated");
  const executed = eventPosition(executedRow, "IssueExecuted");
  if (executed.block !== created.block) return executed.block > created.block;
  if (executed.timestamp !== created.timestamp) return executed.timestamp > created.timestamp;
  if (created.transactionHash === executed.transactionHash) {
    return created.eventIndex != null && executed.eventIndex != null &&
      executed.eventIndex > created.eventIndex;
  }
  return created.eventIndex != null && executed.eventIndex != null &&
    executed.eventIndex > created.eventIndex;
}

async function searchRows(tokenObj, table, params, dependencies) {
  try {
    const response = await dependencies.axios.get(
      `${runtime.rootNodeUrl()}/cirrus/search/${table}`,
      {
        headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
        params,
      }
    );
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    if (error.response && error.response.status === 404) return [];
    throw error;
  }
}

async function findIssueCreated(tokenObj, hash, expectedPayload, dependencies) {
  const rows = await searchRows(
    tokenObj,
    "BlockApps-AdminRegistry-IssueCreated",
    { transaction_hash: `eq.${hash}`, order: "block_number.asc,event_index.asc", limit: "100" },
    dependencies
  );
  const matching = rows.filter((row) => governanceEventMatches(row, expectedPayload));
  if (matching.length > 1) {
    throw new Error(`Submission ${hash} created multiple matching governance issues`);
  }
  const row = matching[0];
  const found = row && field(row, ["issueId", "issue_id"], null);
  return found == null ? null : { issueId: String(found), row };
}

async function findIssueExecuted(
  tokenObj,
  knownIssueId,
  issueCreatedRow,
  expectedPayload,
  dependencies
) {
  const rows = await searchRows(
    tokenObj,
    "BlockApps-AdminRegistry-IssueExecuted",
    {
      address: `eq.${normalizeAddress(
        process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c"
      )}`,
      issueId: `eq.${knownIssueId}`,
      order: "block_number.asc,event_index.asc",
      limit: "100",
    },
    dependencies
  );
  const matching = rows.filter((row) =>
    governanceEventMatches(row, expectedPayload) &&
    eventIsAfter(issueCreatedRow, row));
  if (matching.length > 1) {
    throw new Error(`Issue ${knownIssueId} has multiple matching later executions`);
  }
  const row = matching[0];
  const hash = row && eventTransactionHash(row);
  return hash ? { transactionHash: hash, row } : null;
}

async function authenticateSigner(role, dependencies, expectedOwner) {
  const dependency = dependencies[`authenticate${role[0]}${role.slice(1).toLowerCase()}`];
  if (dependency) {
    const signer = await dependency(expectedOwner);
    return {
      ...signer,
      address: normalizeAddress(signer.address, `${role} authenticated key`),
      username: String(signer.username || role),
      role,
    };
  }
  const username = runtime.requiredEnv(`${role}_USERNAME`);
  const password = runtime.requiredEnv(`${role}_PASSWORD`);
  const expectedAddress = normalizeAddress(
    runtime.requiredEnv(`${role}_ADDRESS`),
    `${role}_ADDRESS`
  );
  const token = await auth.getUserToken(username, password);
  if (!token) throw new Error(`${role} authentication returned no token`);
  const tokenObj = { token };
  const authenticated = normalizeAddress(
    await dependencies.rest.getKey(tokenObj, { config: runtime.config }),
    `${role} authenticated key`
  );
  if (authenticated !== expectedAddress) {
    throw new Error(
      `${role}_ADDRESS ${expectedAddress} does not match authenticated key ${authenticated}`
    );
  }
  return { address: authenticated, token: tokenObj, username, role };
}

async function authenticateOwner(expectedOwner, dependencies) {
  const owner = await authenticateSigner("OWNER", dependencies, expectedOwner);
  return validateOperatorOwner(owner, expectedOwner, dependencies);
}

async function authenticateDeployer(expectedOwner, dependencies) {
  const deployer = await authenticateSigner("DEPLOYER", dependencies, expectedOwner);
  if (expectedOwner !== ADMIN_REGISTRY) {
    return { ...deployer, governance: null };
  }
  return validateAdminSigner(deployer, expectedOwner, dependencies);
}

async function authenticateApprover(dependencies) {
  const approver = await authenticateSigner("APPROVER", dependencies, ADMIN_REGISTRY);
  return validateAdminSigner(approver, ADMIN_REGISTRY, dependencies);
}

async function validateOperatorOwner(operator, expectedOwner, dependencies) {
  if (operator.address === expectedOwner) {
    return { ...operator, storageOwner: expectedOwner, governance: null };
  }
  if (expectedOwner !== ADMIN_REGISTRY) {
    throw new Error(
      `Expected storage owner ${expectedOwner} differs from OWNER signer ${operator.address} ` +
      `and is not configured AdminRegistry ${ADMIN_REGISTRY}`
    );
  }
  return {
    ...await validateAdminSigner(operator, expectedOwner, dependencies),
    storageOwner: expectedOwner,
  };
}

async function validateAdminSigner(operator, registryAddress, dependencies) {
  let membership;
  if (dependencies.readAdminMembership) {
    membership = await dependencies.readAdminMembership(operator.token, registryAddress,
      operator.address);
  } else {
    const registry = await dependencies.rest.getState(
      operator.token,
      { address: registryAddress, name: "AdminRegistry" },
      { config: runtime.config }
    );
    membership = mappingValue(
      field(registry, ["adminMap"], {}),
      [operator.address],
      "0"
    );
  }
  if (bigint(membership, "AdminRegistry.adminMap membership") <= 0n) {
    throw new Error(`${operator.role} signer ${operator.address} is not a live AdminRegistry admin`);
  }
  return {
    ...operator,
    governance: {
      adminRegistry: registryAddress,
      adminMapMembership: String(membership),
      verified: true,
    },
  };
}

function signerIdentity(signer) {
  return {
    role: signer.role,
    address: signer.address,
    username: signer.username,
  };
}

function normalizeLogicAddress(value, label) {
  const text = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  return normalizeAddress(text === DEAD_BEEF ? text.padStart(40, "0") : text, label);
}

async function readProxyIdentity(tokenObj, proxyAddress, dependencies) {
  const proxy = await dependencies.rest.getState(
    tokenObj,
    { address: proxyAddress, name: "Proxy" },
    { config: runtime.config }
  );
  const pick = (names, label, normalize) => {
    for (const name of names) {
      if (typeof proxy[name] !== "string") continue;
      try {
        return normalize(proxy[name], label);
      } catch (_) {
        // A getState response may also include a function signature under this key.
      }
    }
    throw new Error(`${label} is missing`);
  };
  return {
    logicContract: pick(["logicContract"], "Proxy.logicContract", normalizeLogicAddress),
    proxyOwner: pick(["_owner", "owner"], "Proxy owner", normalizeAddress),
  };
}

async function readIdentity(tokenObj, proxyAddress, dependencies, options = {}) {
  const [proxyIdentity, vault] = await Promise.all([
    readProxyIdentity(tokenObj, proxyAddress, dependencies),
    dependencies.rest.getState(
      tokenObj,
      { address: proxyAddress, name: "YieldVault" },
      { config: runtime.config }
    ),
  ]);
  const pickAddress = (state, names, label, fallback) => {
    for (const name of names) {
      if (typeof state[name] !== "string") continue;
      try {
        return normalizeAddress(state[name], label);
      } catch (_) {
        // A getState response may also include a function signature under this key.
      }
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`${label} is missing`);
  };
  const pickBoolean = (state, names, label, fallback) => {
    for (const name of names) {
      if (state[name] == null) continue;
      try {
        return boolean(state[name]);
      } catch (_) {
        // A getState response may also include a function signature under this key.
      }
    }
    if (fallback !== undefined) return fallback;
    throw new Error(`${label} is missing`);
  };
  const uninitializedFallback = options.allowUninitialized === true;
  return {
    ...proxyIdentity,
    owner: pickAddress(vault, ["_owner", "owner"], "YieldVault owner"),
    asset: pickAddress(
      vault,
      ["_asset", "asset"],
      "YieldVault asset",
      uninitializedFallback ? ZERO_ADDRESS : undefined
    ),
    paused: pickBoolean(
      vault,
      ["_paused", "paused"],
      "YieldVault paused state",
      uninitializedFallback ? false : undefined
    ),
    vaultInitialized: pickBoolean(
      vault,
      ["vaultInitialized"],
      "YieldVault initialized state",
      uninitializedFallback ? false : undefined
    ),
    name: String(field(vault, ["_name"], "")),
    symbol: String(field(vault, ["_symbol"], "")),
  };
}

function validateIdentity(identity, expected) {
  if (identity.logicContract !== expected.implementation) {
    throw new Error(
      `Proxy logic pointer mismatch: live=${identity.logicContract} expected=${expected.implementation}`
    );
  }
  if (identity.proxyOwner !== expected.owner || identity.owner !== expected.owner) {
    throw new Error(
      `Owner mismatch: proxy=${identity.proxyOwner} vault=${identity.owner} expected=${expected.owner}`
    );
  }
  if (!identity.vaultInitialized || identity.asset === ZERO_ADDRESS ||
      !identity.name || !identity.symbol) {
    throw new Error("YieldVault identity/state is incomplete or uninitialized");
  }
  if (expected.paused !== undefined && identity.paused !== expected.paused) {
    throw new Error(`Paused state mismatch: live=${identity.paused} expected=${expected.paused}`);
  }
}

async function captureVault(owner, proxyAddress, asset, dependencies) {
  if (dependencies.captureVault) {
    return jsonValue(await dependencies.captureVault({ owner, proxyAddress, asset }));
  }
  const addresses = {
    OWNER: owner.address,
    VAULT_PROXY: proxyAddress,
    ASSET: asset,
  };
  for (const role of [
    "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK",
    "REWARD_DISTRIBUTOR", "DAVE", "DONOR", "SMOKE_USER",
  ]) {
    const configured = process.env[`${role}_ADDRESS`];
    if (configured && configured.trim() && configured !== "REPLACE_ME") {
      addresses[role] = normalizeAddress(configured, `${role}_ADDRESS`);
    }
  }
  return readVaultSnapshot({
    actors: { OWNER: owner },
    addresses,
    assetContractName: process.env.ASSET_CONTRACT_NAME || "Token",
    requestIds: [1, 2, 3],
  });
}

function appendedVaultState(snapshot) {
  return Object.fromEntries(APPENDED_VAULT_FIELDS
    .filter((fieldName) => snapshot && snapshot[fieldName] !== undefined)
    .map((fieldName) => [fieldName, snapshot[fieldName]]));
}

function invariantSnapshot(snapshot, options = {}) {
  const copy = JSON.parse(stableJson(snapshot));
  delete copy.implementation;
  if (options.rollback) {
    for (const fieldName of APPENDED_VAULT_FIELDS) delete copy[fieldName];
  }
  return copy;
}

function assertInvariants(before, after, options = {}) {
  const expected = stableJson(invariantSnapshot(before, options));
  const observed = stableJson(invariantSnapshot(after, options));
  if (expected !== observed) {
    throw new Error(`Vault invariants changed across pointer update`);
  }
}

function assertInternalInvariants(snapshot) {
  if (bigint(snapshot.totalAssets) !==
      bigint(snapshot.idle) + bigint(snapshot.deployedAssets) ||
      bigint(snapshot.totalClaimableAssets) < 0n ||
      bigint(snapshot.totalQueuedShares) < 0n) {
    throw new Error("Live vault accounting invariants are invalid");
  }
}

function deploymentArgs(name, source, args) {
  return {
    name,
    source,
    args,
    txParams: {
      gasPrice: runtime.config.gasPrice,
      gasLimit: runtime.config.gasLimit,
    },
  };
}

function callArgs(proxyAddress, implementationAddress) {
  return {
    contract: { address: proxyAddress, name: "Proxy" },
    method: "setLogicContract",
    args: { _logicContract: implementationAddress },
    txParams: {
      gasPrice: runtime.config.gasPrice,
      gasLimit: runtime.config.gasLimit,
    },
  };
}

function rawArgs(row) {
  let args = field(row, ["args", "arguments"], []);
  if (typeof args === "string") {
    try {
      args = parseJsonPreservingIntegers(args);
    } catch (_) {
      return null;
    }
  }
  return Array.isArray(args) ? args : null;
}

function operationArgsMatch(actual, expected) {
  return actual && actual.length === expected.length &&
    actual.every((value, index) =>
      canonicalOperationArg(value) === canonicalOperationArg(expected[index]));
}

function rawLogicalPayload(row) {
  const args = rawArgs(row);
  if (!args) return null;
  const contractName = field(row, ["cName", "contractName"], null);
  const method = field(row, ["funcName", "functionName", "method"], null);
  if ((contractName == null || contractName === "User") &&
      method === "createContract" && args.length >= 3) {
    const constructorArgs =
      args.length === 3 && Array.isArray(args[2]) ? args[2] : args.slice(2);
    return {
      target: normalizeAddress(field(row, ["to", "contractAddress"], null)),
      func: method,
      args: [args[0], args[1], constructorArgs],
    };
  }
  if (contractName === "User" && method === "callContract" && args.length >= 2) {
    return {
      target: normalizeAddress(args[0]),
      func: String(args[1]).replace(/^['"]|['"]$/g, ""),
      args: args.slice(2),
    };
  }
  const target = field(row, ["to", "contractAddress"], null);
  if (target == null) return null;
  return { target: normalizeAddress(target), func: method, args };
}

function rawMatchesGovernance(row, payload) {
  if (!payload) return false;
  const logical = rawLogicalPayload(row);
  if (!logical) return false;
  return logical.target === payload.target &&
    logical.func === payload.func &&
    logical.func !== "castVoteOnIssue" &&
    operationArgsMatch(logical.args, payload.args);
}

function rawSignerMatches(row, signer) {
  const observed = field(row, ["from", "signer"], null);
  try {
    return normalizeAddress(observed, "raw transaction signer") === signer.address;
  } catch (_) {
    return false;
  }
}

function rawMatchesDeployment(row, expected) {
  const args = rawArgs(row);
  if (!args) return false;
  const contractName = field(row, ["cName", "contractName"], null);
  const method = field(row, ["funcName", "functionName", "method"], null);
  if (contractName === expected.name && method !== "createContract") {
    const source = field(row, ["code", "contractSrc", "source"], null);
    return field(row, ["to", "contractAddress"], null) == null &&
      source === expected.sourceText &&
      submittedSourceHash(source || "") === expected.sourceHash &&
      operationArgsMatch(args, expected.constructorArgs);
  }
  if ((contractName == null || contractName === "User") &&
      method === "createContract" && args.length >= 3) {
    const source = decodedSourceText(args[1]);
    const submittedConstructorArgs =
      args.length === 3 && Array.isArray(args[2]) ? args[2] : args.slice(2);
    return String(args[0]).replace(/^['"]|['"]$/g, "") === expected.name &&
      source === expected.sourceText &&
      submittedSourceHash(source || "") === expected.sourceHash &&
      operationArgsMatch(submittedConstructorArgs, expected.constructorArgs);
  }
  return rawMatchesGovernance(row, expected.governancePayload);
}

async function readRawTransaction(tokenObj, hash, dependencies) {
  const expectedHash = transactionHash({ hash });
  if (!expectedHash) throw new Error(`Invalid raw transaction hash: ${hash}`);
  const response = await dependencies.axios.get(
    `${runtime.rootNodeUrl()}/strato-api/eth/v1.2/transaction`,
    {
      headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
      params: { hash: expectedHash, limit: "2" },
    }
  );
  const rows = Array.isArray(response.data) ? response.data : [];
  if (rows.length !== 1) {
    throw new Error(`Raw transaction ${expectedHash} returned ${rows.length} rows`);
  }
  if (transactionHash(rows[0]) !== expectedHash) {
    throw new Error(`Raw transaction hash mismatch for ${expectedHash}`);
  }
  return rows[0];
}

async function accountSubmissionState(context, signer) {
  const read = context.dependencies.readAccountSubmissionState ||
    readAccountSubmissionState;
  const state = await read(signer.token, signer.address);
  if (!state || state.sequence == null || !/^\d+$/.test(String(state.sequence))) {
    throw new Error(`${signer.role} account sequence is unavailable before dispatch`);
  }
  return state;
}

async function recoverAmbiguousDispatch(context, id, spec, deadline) {
  ensureDeadline(deadline, id);
  const entry = context.journal.state.checkpoints[id];
  const nonce = entry.submittedNonce == null
    ? entry.preSubmissionSequence
    : entry.submittedNonce;
  if (nonce == null) {
    throw new WorkflowStop(id, "ambiguous_dispatch_no_sequence", null, entry);
  }
  const lookup = await (context.dependencies.lookupRawSubmission || lookupRawSubmission)(
    spec.signer.token,
    spec.signer.address,
    nonce
  );
  const observedRows = [...lookup.rows || [], ...lookup.queuedRows || []];
  const candidates = observedRows.filter((row) => spec.matchesRawTransaction(row));
  const hashes = [...new Set(candidates.map(transactionHash).filter(Boolean))];
  if (hashes.length === 1 && candidates.length === observedRows.length) {
    context.journal.transition(id, "submitted", {
      transactionHash: hashes[0],
      recoveredByAccountSequence: true,
      recoveryLookup: lookup,
    });
    return reconcileOperation(context, id, spec, deadline);
  }
  if (hashes.length > 1 || observedRows.length) {
    throw new WorkflowStop(id, "ambiguous_dispatch_intent_mismatch", null, {
      nonce,
      exactMatchCount: hashes.length,
      lookup,
    });
  }
  const account = await accountSubmissionState(context, spec.signer);
  const definitivelyAbsent = lookup.lookupPerformed === true &&
    lookup.queuedLookupPerformed === true &&
    String(account.sequence) === String(nonce);
  if (!definitivelyAbsent) {
    throw new WorkflowStop(id, "ambiguous_dispatch_unresolved", null, { nonce, account, lookup });
  }
  if (Number(entry.replacementCount || 0) >= 1) {
    throw new WorkflowStop(id, "replacement_already_used", null, { nonce, account, lookup });
  }
  context.journal.transition(id, "ready", {
    replacementCount: 1,
    definitiveAbsenceEvidence: { nonce: String(nonce), account, lookup },
  });
  return executeOperation(context, id, spec, deadline);
}

function approvalCallArgs(payload) {
  if (!payload || payload.func === "castVoteOnIssue") {
    throw new Error("Governance approval requires an exact non-castVoteOnIssue payload");
  }
  if (payload.func === "createContract") {
    if (payload.args.length !== 3 || !Array.isArray(payload.args[2])) {
      throw new Error("User.createContract approval requires nested constructor arguments");
    }
    return {
      contract: { address: payload.target, name: "User" },
      method: "createContract",
      args: {
        contractName: payload.args[0],
        contractSrc: payload.args[1],
        args: payload.args[2].map((argument) =>
          typeof argument === "string" ? JSON.stringify(argument) : argument),
      },
      txParams: { gasPrice: runtime.config.gasPrice, gasLimit: runtime.config.gasLimit },
    };
  }
  if (payload.func === "setLogicContract" && payload.args.length === 1) {
    return callArgs(payload.target, payload.args[0]);
  }
  throw new Error(`Unsupported local governance approval ${payload.func}`);
}

async function recoverApprovalDispatch(context, id, payload, approval) {
  const nonce = approval.submittedNonce == null
    ? approval.preSubmissionSequence
    : approval.submittedNonce;
  if (nonce == null) {
    throw new WorkflowStop(id, "ambiguous_approval_no_sequence", null, approval);
  }
  const lookup = await (context.dependencies.lookupRawSubmission || lookupRawSubmission)(
    context.approver.token,
    context.approver.address,
    nonce
  );
  const rows = [...lookup.rows || [], ...lookup.queuedRows || []];
  const exact = rows.filter((row) =>
    rawSignerMatches(row, context.approver) && rawMatchesGovernance(row, payload));
  const hashes = [...new Set(exact.map(transactionHash).filter(Boolean))];
  if (rows.length && (hashes.length !== 1 || exact.length !== rows.length)) {
    throw new WorkflowStop(id, "ambiguous_approval_intent_mismatch", null, {
      nonce,
      exactMatchCount: hashes.length,
      lookup,
    });
  }
  if (hashes.length === 1) {
    return {
      transactionHash: hashes[0],
      recoveredByApproverSequence: true,
      recoveryLookup: lookup,
    };
  }
  const account = await accountSubmissionState(context, context.approver);
  if (lookup.lookupPerformed !== true || lookup.queuedLookupPerformed !== true ||
      String(account.sequence) !== String(nonce)) {
    throw new WorkflowStop(id, "ambiguous_approval_unresolved", null, {
      nonce,
      account,
      lookup,
    });
  }
  return { definitivelyAbsent: true, nonce: String(nonce), account, lookup };
}

async function approveOperation(context, id, spec, payload, deadline) {
  if (!context.approver || context.approver.address === spec.signer.address) {
    throw new Error(`${id} APPROVER must differ from the primary signer`);
  }
  if (!context.approver.governance ||
      bigint(context.approver.governance.adminMapMembership) <= 0n) {
    throw new Error(`${id} APPROVER is not a verified live AdminRegistry admin`);
  }
  const { journal, dependencies } = context;
  let entry = journal.state.checkpoints[id];
  let approval = entry.governanceApproval || null;
  const call = approvalCallArgs(payload);
  if (!approval) {
    approval = {
      status: "ready",
      intentPersistedAt: new Date().toISOString(),
      approver: signerIdentity(context.approver),
      target: payload.target,
      func: payload.func,
      args: payload.args,
      call,
    };
    journal.transition(id, "submitted", { governanceApproval: approval });
    await dependencies.injectFault("after_approval_ready", { checkpoint: id, payload });
  } else if (
    approval.approver.role !== "APPROVER" ||
    normalizeAddress(approval.approver.address) !== context.approver.address ||
    stableJson({ target: approval.target, func: approval.func, args: approval.args }) !==
      stableJson(payload)
  ) {
    throw new Error(`${id} saved governance approval intent changed`);
  }

  let approvalHash = approval.transactionHash || null;
  if (!approvalHash && approval.status === "dispatching") {
    const recovered = await recoverApprovalDispatch(context, id, payload, approval);
    if (recovered.transactionHash) {
      approval = { ...approval, ...recovered, status: "submitted" };
      approvalHash = recovered.transactionHash;
    } else {
      approval = {
        ...approval,
        status: "ready",
        definitiveAbsenceEvidence: recovered,
      };
    }
    journal.transition(id, "submitted", { governanceApproval: approval });
  }
  if (!approvalHash && approval.status === "ready") {
    const account = await accountSubmissionState(context, context.approver);
    approval = {
      ...approval,
      status: "dispatching",
      dispatchingAt: new Date().toISOString(),
      preSubmissionSequence: String(account.sequence),
      accountBeforeSubmission: account,
    };
    journal.transition(id, "submitted", { governanceApproval: approval });
    await dependencies.injectFault("after_approval_dispatching", { checkpoint: id, payload });
    let response;
    try {
      response = await dependencies.rest.call(
        context.approver.token,
        call,
        { config: runtime.config, cacheNonce: false, isAsync: true }
      );
    } catch (error) {
      approval = {
        ...approval,
        submittedNonce: submissionSequence(error),
        submissionError: { name: error.name, message: error.message },
      };
      journal.transition(id, "submitted", { governanceApproval: approval });
      throw new WorkflowStop(id, "ambiguous_approval_no_hash", null, approval);
    }
    approvalHash = transactionHash(response);
    if (!approvalHash) {
      approval = {
        ...approval,
        submittedNonce: submissionSequence(response),
        rawSubmission: response,
      };
      journal.transition(id, "submitted", { governanceApproval: approval });
      throw new WorkflowStop(id, "ambiguous_approval_no_hash", null, approval);
    }
    approval = {
      ...approval,
      status: "submitted",
      transactionHash: approvalHash,
      submittedNonce: submissionSequence(response),
      rawSubmission: response,
      submittedAt: new Date().toISOString(),
    };
    journal.transition(id, "submitted", { governanceApproval: approval });
    await dependencies.injectFault("after_approval_submitted", {
      checkpoint: id,
      transactionHash: approvalHash,
    });
  }
  if (!approvalHash) {
    throw new WorkflowStop(id, "ambiguous_approval_no_hash", null, approval);
  }
  const raw = await (dependencies.readRawTransaction ||
    ((token, hash) => readRawTransaction(token, hash, dependencies)))(
    context.approver.token,
    approvalHash
  );
  if (!rawSignerMatches(raw, context.approver) || !rawMatchesGovernance(raw, payload)) {
    throw new Error(`${id} APPROVER raw transaction does not exactly match governance payload`);
  }
  approval = {
    ...approval,
    rawTransaction: raw,
    rawPayloadVerified: true,
  };
  journal.transition(id, "submitted", { governanceApproval: approval });
  let receipt = approval.receipt || null;
  if (!receipt || !receipt.status || receipt.status === "Pending") {
    receipt = await pollReceipt(
      context.approver.token,
      approvalHash,
      deadline,
      dependencies,
      (latest) => journal.transition(id, "submitted", {
        governanceApproval: {
          ...journal.state.checkpoints[id].governanceApproval,
          receipt: latest,
        },
      })
    );
  }
  if (!receipt || !receipt.status || receipt.status === "Pending") {
    throw new WorkflowStop(id, "timeout", approvalHash, receipt);
  }
  if (receipt.status !== "Success") {
    throw new WorkflowStop(id, "failed_governance_receipt", approvalHash, receipt);
  }
  approval = {
    ...journal.state.checkpoints[id].governanceApproval,
    status: "confirmed",
    receipt,
    confirmedAt: new Date().toISOString(),
  };
  journal.transition(id, "submitted", { governanceApproval: approval });
  console.log(
    `GOVERNANCE_APPROVAL checkpoint=${id} approver=${context.approver.address} ` +
    `target=${payload.target} func=${payload.func} args=${stableJson(payload.args)} ` +
    `txHash=${approvalHash}`
  );
  return approval;
}

async function reconcileOperation(context, id, spec, deadline) {
  const { journal, dependencies } = context;
  const signer = spec.signer;
  let entry = journal.state.checkpoints[id];
  let receipt = entry.receipt || null;
  if (entry.transactionHash && (!receipt || !receipt.status || receipt.status === "Pending")) {
    receipt = await pollReceipt(
      signer.token,
      entry.transactionHash,
      deadline,
      dependencies,
      (latest) => journal.transition(id, "submitted", { receipt: latest })
    );
  }
  if (entry.transactionHash && (!receipt || !receipt.status || receipt.status === "Pending")) {
    throw new WorkflowStop(id, "timeout", entry.transactionHash, receipt);
  }
  if (receipt && receipt.status !== "Success") {
    throw new WorkflowStop(id, "failed_receipt", entry.transactionHash, receipt);
  }

  let governancePayload = spec.governancePayload;
  if (entry.transactionHash && spec.resolveGovernancePayload) {
    const resolved = await spec.resolveGovernancePayload(entry.transactionHash);
    const recorded = entry.governancePayload || (
      entry.governanceIssueTarget && entry.governanceIssueFunction &&
      Array.isArray(entry.governanceIssueArguments)
        ? {
            target: entry.governanceIssueTarget,
            func: entry.governanceIssueFunction,
            args: entry.governanceIssueArguments,
          }
        : null
    );
    if (recorded && stableJson(recorded) !== stableJson(resolved)) {
      throw new Error(`${id} resolved governance payload changed`);
    }
    governancePayload = resolved;
    if (governancePayload) {
      journal.transition(id, "submitted", {
        governancePayload,
        governanceIssueTarget: governancePayload.target,
        governanceIssueFunction: governancePayload.func,
        governanceIssueArguments: governancePayload.args,
      });
      entry = journal.state.checkpoints[id];
    }
  }
  let knownIssueId = entry.governanceIssueId || issueId(receipt) || issueId(entry.rawSubmission);
  let issueCreatedRow = entry.governanceIssueCreatedEvent || null;
  const receiptAlreadyProvesCompletion = spec.receiptProvesCompletion
    ? await spec.receiptProvesCompletion(receipt)
    : false;
  if (entry.transactionHash && spec.mayGovern && !governancePayload &&
      !receiptAlreadyProvesCompletion) {
    throw new Error(`${id} cannot discover governance without a resolved payload`);
  }
  if (knownIssueId && !governancePayload) {
    throw new Error(`${id} has a governance issue without a resolved payload`);
  }
  if (entry.transactionHash && spec.mayGovern && (!knownIssueId || !issueCreatedRow) &&
      (!receiptAlreadyProvesCompletion || spec.discoverGovernanceAfterCompletion)) {
    do {
      const created = await findIssueCreated(
        signer.token,
        entry.transactionHash,
        governancePayload,
        dependencies
      );
      if (created) {
        if (knownIssueId && String(knownIssueId) !== created.issueId) {
          throw new Error(`Receipt issue ${knownIssueId} does not match IssueCreated`);
        }
        knownIssueId = created.issueId;
        issueCreatedRow = created.row;
        const position = eventPosition(created.row, "IssueCreated");
        journal.transition(id, "submitted", {
          governanceIssueId: knownIssueId,
          governancePayload,
          governanceIssueTarget: governancePayload.target,
          governanceIssueFunction: governancePayload.func,
          governanceIssueArguments: governancePayload.args,
          governanceIssueCreationBlock: position.block,
          governanceIssueCreationTimestamp: position.timestamp,
          governanceIssueCreatedEvent: created.row,
        });
        console.log(
          `GOVERNANCE_ISSUE checkpoint=${id} submissionHash=${entry.transactionHash} ` +
          `issueId=${knownIssueId} target=${governancePayload.target} ` +
          `func=${governancePayload.func} args=${stableJson(governancePayload.args)} ` +
          `creationBlock=${position.block} creationTimestamp=${position.timestamp}`
        );
        break;
      }
      if (receiptAlreadyProvesCompletion || Date.now() >= deadline) break;
      await dependencies.sleep(
        Math.min(dependencies.pollMs, Math.max(1, deadline - Date.now()))
      );
      if (spec.receiptProvesCompletion &&
          await spec.receiptProvesCompletion(receipt)) {
        break;
      }
    } while (Date.now() < deadline);
  }
  if (!knownIssueId && spec.receiptProvesCompletion &&
      !await spec.receiptProvesCompletion(receipt)) {
    throw new WorkflowStop(
      id,
      Date.now() >= deadline ? "timeout" : "unknown_status",
      entry.transactionHash,
      { receipt, expectedEffectNotObserved: true }
    );
  }

  let execution = entry.governanceExecution || null;
  let approval = entry.governanceApproval || null;
  let externalExecution = false;
  if (knownIssueId) {
    if (!issueCreatedRow) {
      throw new WorkflowStop(id, "unknown_governance_creation", entry.transactionHash);
    }
    execution = await findIssueExecuted(
      signer.token,
      knownIssueId,
      issueCreatedRow,
      governancePayload,
      dependencies
    ) || execution;
    externalExecution = execution &&
      (!approval || !sameTransactionHash(
        execution.transactionHash,
        approval.transactionHash
      ));
    if (externalExecution) {
      const reconciliation = externalGovernanceExecutionReconciliation(
        knownIssueId,
        execution,
        approval
      );
      journal.transition(id, "submitted", reconciliation);
      if (reconciliation.governanceCleanupRecommendation) {
        console.warn(
          `GOVERNANCE_CLEANUP_RECOMMENDED checkpoint=${id} issueId=${knownIssueId} ` +
          `approvalHash=${reconciliation.governanceCleanupRecommendation
            .redundantApprovalTransactionHash} action=${reconciliation
            .governanceCleanupRecommendation.action}`
        );
      }
    } else if (!execution) {
      approval = await approveOperation(context, id, spec, governancePayload, deadline);
    }
  }
  if (knownIssueId && !execution) {
    while (Date.now() < deadline && !execution) {
      execution = await findIssueExecuted(
        signer.token,
        knownIssueId,
        issueCreatedRow,
        governancePayload,
        dependencies
      );
      if (!execution) {
        await dependencies.sleep(Math.min(dependencies.pollMs, Math.max(1, deadline - Date.now())));
      }
    }
    if (!execution) {
      throw new WorkflowStop(id, "pending_governance", entry.transactionHash, {
        governanceIssueId: knownIssueId,
      });
    }
    if (!externalExecution &&
        !sameTransactionHash(execution.transactionHash, approval.transactionHash)) {
      throw new Error(`${id} IssueExecuted transaction does not match the exact APPROVER call`);
    }
    journal.transition(id, "submitted", {
      governanceIssueId: knownIssueId,
      governanceExecution: execution,
      governanceExecutionTransactionHash: execution.transactionHash,
      governanceExecutionSource: externalExecution
        ? "external_or_manual"
        : "automatic_approval",
    });
  } else if (knownIssueId && execution) {
    journal.transition(id, "submitted", {
      governanceIssueId: knownIssueId,
      governanceExecution: execution,
      governanceExecutionTransactionHash: execution.transactionHash,
      governanceExecutionSource: externalExecution
        ? "external_or_manual"
        : "automatic_approval",
    });
  }

  let executionReceipt = entry.governanceExecutionReceipt || null;
  if (execution && execution.transactionHash) {
    executionReceipt = await pollReceipt(
      signer.token,
      execution.transactionHash,
      deadline,
      dependencies,
      (latest) => journal.transition(id, "submitted", {
        governanceExecutionReceipt: latest,
      })
    );
    if (!executionReceipt || !executionReceipt.status ||
        executionReceipt.status === "Pending") {
      throw new WorkflowStop(id, "timeout", execution.transactionHash, executionReceipt);
    }
    if (executionReceipt.status !== "Success") {
      throw new WorkflowStop(id, "failed_governance_receipt", execution.transactionHash,
        executionReceipt);
    }
    console.log(
      `GOVERNANCE_EXECUTION checkpoint=${id} issueId=${knownIssueId} ` +
      `txHash=${execution.transactionHash} status=${executionReceipt.status}`
    );
  }

  entry = journal.state.checkpoints[id];
  const result = await spec.confirm({
    receipt,
    executionReceipt,
    entry,
    deadline,
  });
  journal.transition(id, "confirmed", {
    receipt,
    governanceIssueId: knownIssueId,
    governanceExecution: execution,
    governanceExecutionReceipt: executionReceipt,
    result,
  });
  console.log(
    `UPGRADE_SAFETY_CONFIRMED checkpoint=${id} ` +
    `txHash=${entry.transactionHash || execution && execution.transactionHash || "none"}`
  );
  return journal.state.checkpoints[id];
}

async function executeOperation(context, id, spec, deadline) {
  ensureDeadline(deadline, id);
  if (spec.onlyOwner === true || spec.registryContract) {
    assertMarkedOnlyOwner(spec, id);
    if (!registeredCheckpoint("localUpgrade", id, spec.registryContract, spec.method)) {
      throw new Error(`Unregistered local-upgrade onlyOwner checkpoint ${id}`);
    }
  }
  const { journal, dependencies } = context;
  if (!spec.signer || !spec.signer.token || !spec.signer.address || !spec.signer.role) {
    throw new Error(`Operation ${id} has no authenticated signer`);
  }
  let entry = journal.state.checkpoints[id];
  if (entry && entry.status === "confirmed") {
    if (spec.revalidate) await spec.revalidate(entry);
    return entry;
  }
  if (entry && entry.status === "dispatching") {
    return recoverAmbiguousDispatch(context, id, spec, deadline);
  }
  if (entry && entry.status === "submitted") {
    return reconcileOperation(context, id, spec, deadline);
  }
  if (!entry) {
    journal.transition(id, "ready", {
      operation: spec.operation,
      signer: signerIdentity(spec.signer),
      submissionAttempt: spec.submissionEvidence,
      readyEvidence: {
        ...spec.readyEvidence,
        signer: signerIdentity(spec.signer),
      },
    });
    await dependencies.injectFault("after_ready", { checkpoint: id });
  }
  const accountBeforeSubmission = await accountSubmissionState(context, spec.signer);
  journal.transition(id, "dispatching", {
    dispatchAttempt: Number(
      journal.state.checkpoints[id].dispatchAttempt || 0
    ) + 1,
    preSubmissionSequence: String(accountBeforeSubmission.sequence),
    accountBeforeSubmission,
  });
  await dependencies.injectFault("after_dispatching", { checkpoint: id });

  let response;
  try {
    response = await spec.submit();
  } catch (error) {
    journal.transition(id, "dispatching", {
      submissionError: { name: error.name, message: error.message },
      submittedNonce: submissionSequence(error),
    });
    throw new WorkflowStop(id, "ambiguous_dispatch_no_hash", null, {
      message: error.message,
    });
  }
  const hash = transactionHash(response);
  const knownIssueId = issueId(response);
  if (!hash && !knownIssueId) {
    journal.transition(id, "dispatching", {
      rawSubmission: response,
      submittedNonce: submissionSequence(response),
    });
    throw new WorkflowStop(id, "ambiguous_dispatch_no_hash", null, response);
  }
  journal.transition(id, "submitted", {
    transactionHash: hash,
    governanceIssueId: knownIssueId,
    rawSubmission: response,
  });
  if (knownIssueId && spec.governancePayload) {
    console.log(
      `GOVERNANCE_ISSUE checkpoint=${id} submissionHash=${hash || "none"} ` +
      `issueId=${knownIssueId} target=${spec.governancePayload.target} ` +
      `func=${spec.governancePayload.func} args=${stableJson(spec.governancePayload.args)}`
    );
  }
  await dependencies.injectFault("after_submitted", {
    checkpoint: id,
    transactionHash: hash,
    governanceIssueId: knownIssueId,
  });
  return reconcileOperation(context, id, spec, deadline);
}

function defaultDependencies(overrides = {}) {
  return {
    axios,
    rest,
    combine: importer.combine,
    pollMs: DEFAULT_POLL_MS,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    injectFault: async () => {},
    ...overrides,
  };
}

async function prepareContext(options, evidence, dependencies) {
  const configurationHash = hashValue(options.configuration);
  const journal = new WorkflowJournal(options.runState, options.evidenceOutput, {
    script: options.script,
    mode: options.mode,
    configurationHash,
    configuration: options.configuration,
    evidence,
  });
  journal.acquire();
  try {
    ensureDeadline(options.deadline, "preflight");
    const owner = await authenticateOwner(options.expectedOwner, dependencies);
    const deployer = options.requireDeployer === false
      ? null
      : await authenticateDeployer(options.expectedOwner, dependencies);
    const approver = await authenticateApprover(dependencies);
    if (deployer && deployer.address === owner.address) {
      throw new Error("DEPLOYER and OWNER must authenticate distinct signer addresses");
    }
    if (approver.address === owner.address ||
        deployer && approver.address === deployer.address) {
      throw new Error("APPROVER must authenticate a signer distinct from OWNER and DEPLOYER");
    }
    ensureDeadline(options.deadline, "preflight");
    const getMetadata = dependencies.getMetadata || (async () => {
      const response = await dependencies.axios.get(
        `${runtime.rootNodeUrl()}/strato-api/eth/v1.2/metadata`,
        {
          headers: { Authorization: `Bearer ${owner.token.token}`, Accept: "application/json" },
          timeout: Math.max(1, options.deadline - Date.now()),
        }
      );
      return response.data;
    });
    const network = await runtime.fetchExpectedTestnetNetwork(
      owner.token,
      getMetadata
    );
    ensureDeadline(options.deadline, "preflight");
    const signers = {
      OWNER: owner,
      APPROVER: approver,
      ...(deployer ? { DEPLOYER: deployer } : {}),
    };
    const recordedSigners = journal.state.evidence && journal.state.evidence.signers;
    const legacyOwner = journal.state.evidence && journal.state.evidence.operatorSigner;
    const legacyDeployer = journal.state.evidence && journal.state.evidence.deploymentSigner;
    if (legacyOwner &&
        normalizeAddress(legacyOwner, "recorded operator signer") !== owner.address) {
      throw new Error("Existing run-state OWNER signer does not match authenticated identity");
    }
    if (deployer && legacyDeployer &&
        normalizeAddress(legacyDeployer, "recorded deployment signer") !== deployer.address) {
      throw new Error("Existing run-state DEPLOYER signer does not match authenticated identity");
    }
    for (const [role, signer] of Object.entries(signers)) {
      const recorded = recordedSigners && recordedSigners[role];
      if (recorded &&
          (normalizeAddress(recorded.address, `recorded ${role} signer`) !== signer.address ||
           recorded.role !== role || recorded.username !== signer.username)) {
        throw new Error(`Existing run-state ${role} signer does not match authenticated identity`);
      }
    }
    journal.updateEvidence({
      network,
      owner: options.expectedOwner,
      expectedStorageOwner: options.expectedOwner,
      operatorSigner: owner.address,
      operatorGovernance: owner.governance,
      approvalSigner: approver.address,
      approvalGovernance: approver.governance,
      deploymentSigner: deployer && deployer.address,
      deploymentGovernance: deployer && deployer.governance,
      signers: Object.fromEntries(
        Object.entries(signers).map(([role, signer]) => [role, signerIdentity(signer)])
      ),
    });
    return { journal, owner, approver, deployer, network, dependencies };
  } catch (error) {
    journal.release();
    throw error;
  }
}

function deploySpec(context, name, source, args, sourceEvidence) {
  const constructorArgs = Object.values(args);
  return {
    operation: `deploy ${name}`,
    signer: context.deployer,
    onlyOwner: true,
    governed: true,
    registryContract: "User",
    method: "createContract",
    submissionEvidence: {
      signer: signerIdentity(context.deployer),
      contractName: name,
      constructorArguments: args,
      source: sourceEvidence,
    },
    readyEvidence: { network: context.network, source: sourceEvidence },
    mayGovern: true,
    governancePayload: null,
    async resolveGovernancePayload(transactionHashValue) {
      const readRaw = context.dependencies.readRawTransaction ||
        ((token, hash) => readRawTransaction(token, hash, context.dependencies));
      const row = await readRaw(context.deployer.token, transactionHashValue);
      const expected = {
        name,
        sourceText: source.source,
        sourceHash: sourceEvidence.combinedSourceHash,
        constructorArgs,
        governancePayload: null,
      };
      if (!rawSignerMatches(row, context.deployer) ||
          !rawMatchesDeployment(row, expected)) {
        throw new Error(`${name} raw submission does not match deployment intent`);
      }
      const method = field(row, ["funcName", "functionName", "method"], null);
      if (method !== "createContract") return null;
      const target = normalizeAddress(
        field(row, ["to", "contractAddress"], null),
        `${name} User.createContract target`
      );
      return {
        target,
        func: "createContract",
        args: [name, source.source, constructorArgs],
      };
    },
    matchesRawTransaction: (row) => rawSignerMatches(row, context.deployer) &&
      rawMatchesDeployment(row, {
        name,
        sourceText: source.source,
        sourceHash: sourceEvidence.combinedSourceHash,
        constructorArgs,
        governancePayload: null,
      }),
    receiptProvesCompletion: (receipt) => Boolean(createdAddress(receipt)),
    submit: () => context.dependencies.rest.createContract(
      context.deployer.token,
      deploymentArgs(name, source.source, args),
      {
        config: runtime.config,
        history: [name],
        cacheNonce: false,
        isAsync: true,
        query: { username: "BlockApps" },
      }
    ),
    async confirm({ receipt, executionReceipt }) {
      const creationReceipt = executionReceipt || receipt;
      const address = createdAddress(creationReceipt);
      if (!address) {
        throw new Error(
          `${name} deployment receipt has no created address: ${stableJson(creationReceipt)}`
        );
      }
      const state = await context.dependencies.rest.getState(
        context.deployer.token,
        { address, name },
        { config: runtime.config }
      );
      if (!state || typeof state !== "object") {
        throw new Error(`${name} deployment has no live created state`);
      }
      const expectedConstructorOwner = args._initialOwner || args.initialOwner;
      if (expectedConstructorOwner) {
        const observedOwner = field(state, ["_owner", "owner"], null);
        if (observedOwner != null &&
            normalizeAddress(observedOwner, `${name} constructor owner`) !==
              normalizeLogicAddress(expectedConstructorOwner, `${name} expected constructor owner`)) {
          throw new Error(`${name} live constructor owner mismatch`);
        }
      }
      return {
        address,
        submissionReceipt: receipt,
        creationReceipt,
        creationTransactionHash:
          transactionHash(creationReceipt),
      };
    },
    async revalidate(entry) {
      const result = entry.result || {};
      const receiptHash = result.creationTransactionHash ||
        transactionHash(result.creationReceipt);
      if (!receiptHash) throw new Error(`${name} confirmed checkpoint has no creation hash`);
      const response = await context.dependencies.rest.getBlocResults(
        context.deployer.token,
        [receiptHash],
        { config: runtime.config, isAsync: true }
      );
      const receipt = receiptFrom(response);
      if (!receipt || receipt.status !== "Success" ||
          createdAddress(receipt) !== result.address) {
        throw new Error(`${name} confirmed deployment no longer matches its live receipt`);
      }
      const state = await context.dependencies.rest.getState(
        context.deployer.token,
        { address: result.address, name },
        { config: runtime.config }
      );
      if (!state || typeof state !== "object") {
        throw new Error(`${name} confirmed deployment has no live state`);
      }
      if (name === "Proxy") {
        const identity = await readProxyIdentity(
          context.deployer.token,
          result.address,
          context.dependencies
        );
        if (identity.proxyOwner !== args._initialOwner) {
          throw new Error("Confirmed Proxy owner changed");
        }
      } else if (args.initialOwner) {
        const observedOwner = field(state, ["_owner", "owner"], null);
        if (observedOwner == null ||
            normalizeAddress(observedOwner, `${name} live constructor owner`) !==
              normalizeLogicAddress(args.initialOwner, `${name} expected constructor owner`)) {
          throw new Error(`Confirmed ${name} constructor owner changed`);
        }
      }
    },
  };
}

function pointerSpec(context, options) {
  const governancePayload = {
    target: options.proxyAddress,
    func: "setLogicContract",
    args: [options.implementationAddress],
  };
  return {
    operation: options.operation,
    signer: context.owner,
    onlyOwner: true,
    governed: true,
    registryContract: "Proxy",
    method: "setLogicContract",
    submissionEvidence: {
      signer: signerIdentity(context.owner),
      proxyAddress: options.proxyAddress,
      method: "setLogicContract",
      implementationAddress: options.implementationAddress,
    },
    readyEvidence: {
      network: context.network,
      expectedOwner: options.expectedOwner,
      expectedCurrentImplementation: options.expectedCurrentImplementation,
      preIdentity: options.preIdentity,
      preSnapshot: options.preSnapshot,
    },
    mayGovern: true,
    governancePayload,
    matchesRawTransaction(row) {
      const logical = rawLogicalPayload(row);
      return rawSignerMatches(row, context.owner) && (Boolean(logical &&
        logical.target === options.proxyAddress &&
        logical.func === "setLogicContract" &&
        operationArgsMatch(logical.args, governancePayload.args)) ||
        rawMatchesGovernance(row, governancePayload));
    },
    discoverGovernanceAfterCompletion: true,
    async receiptProvesCompletion() {
      const identity = await readIdentity(
        context.owner.token,
        options.proxyAddress,
        context.dependencies
      );
      return identity.logicContract === options.implementationAddress;
    },
    submit: () => context.dependencies.rest.call(
      context.owner.token,
      callArgs(options.proxyAddress, options.implementationAddress),
      { config: runtime.config, cacheNonce: false, isAsync: true }
    ),
    async confirm() {
      let identity;
      do {
        identity = await readIdentity(
          context.owner.token,
          options.proxyAddress,
          context.dependencies
        );
        if (identity.logicContract === options.implementationAddress) break;
        await context.dependencies.sleep(
          Math.min(
            context.dependencies.pollMs,
            Math.max(1, options.deadline - Date.now())
          )
        );
      } while (Date.now() < options.deadline);
      if (identity.logicContract !== options.implementationAddress) {
        throw new WorkflowStop(
          options.operation,
          "timeout",
          null,
          { expectedImplementation: options.implementationAddress, identity }
        );
      }
      validateIdentity(identity, {
        implementation: options.implementationAddress,
        owner: options.expectedOwner,
        paused: options.requirePaused ? true : undefined,
      });
      const postSnapshot = await captureVault(
        context.owner,
        options.proxyAddress,
        identity.asset,
        context.dependencies
      );
      assertInvariants(options.preSnapshot, postSnapshot, { rollback: options.rollback });
      assertInternalInvariants(postSnapshot);
      return {
        proxyAddress: options.proxyAddress,
        confirmedImplementation: identity.logicContract,
        postIdentity: identity,
        postSnapshot,
        invariantsPreserved: true,
        rollbackComparison: options.rollback
          ? {
              comparedLegacyFieldsAndUnderlyingBalances: true,
              excludedAppendedViewFields: APPENDED_VAULT_FIELDS,
              appendedPreRollbackValues: appendedVaultState(options.preSnapshot),
              limitation:
                "Old implementation ABI cannot independently expose appended accrual fields",
            }
          : null,
      };
    },
    async revalidate() {
      const identity = await readIdentity(
        context.owner.token,
        options.proxyAddress,
        context.dependencies
      );
      validateIdentity(identity, {
        implementation: options.implementationAddress,
        owner: options.expectedOwner,
        paused: options.requirePaused ? true : undefined,
      });
      const liveSnapshot = await captureVault(
        context.owner,
        options.proxyAddress,
        identity.asset,
        context.dependencies
      );
      assertInternalInvariants(liveSnapshot);
    },
  };
}

function checkpointResult(journal, id) {
  const checkpoint = journal.state.checkpoints[id];
  return checkpoint && checkpoint.result;
}

function submissionEvidence(checkpoint) {
  const executionHash = checkpoint.governanceExecution &&
    checkpoint.governanceExecution.transactionHash || null;
  return {
    signer: checkpoint.signer,
    submissionHashes: checkpoint.transactionHash
      ? [checkpoint.transactionHash]
      : executionHash
        ? [executionHash]
        : [],
    receipt: checkpoint.receipt || null,
    governance: checkpoint.governanceIssueId
      ? {
          issueId: checkpoint.governanceIssueId,
          executionTransactionHash: executionHash,
          executionReceipt: checkpoint.governanceExecutionReceipt || null,
        }
      : null,
  };
}

async function runDeployOldProxy(options, overrides = {}) {
  const deadline = Date.now() + (options.deadlineMs || DEFAULT_DEADLINE_MS);
  const dependencies = defaultDependencies(overrides);
  const contractsDir = runtime.config.resolvePath(runtime.config.contractsDir);
  const proxySource = await combineReviewedSource(
    path.join(contractsDir, "Proxy/Proxy.sol"),
    dependencies.combine
  );
  const oldSource = await combineReviewedSource(
    path.join(__dirname, "..", "YieldVaultOld.sol"),
    dependencies.combine
  );
  const proxySourceEvidence = verifyReviewedSource(
    proxySource,
    options.expectedProxySourceHash,
    "EXPECTED_PROXY_SOURCE_HASH"
  );
  const oldSourceEvidence = verifyReviewedSource(
    oldSource,
    options.expectedOldSourceHash,
    "EXPECTED_OLD_REVIEWED_SOURCE_HASH"
  );
  const expectedOwner = normalizeAddress(options.expectedOwner, "expected owner");
  const configuration = {
    expectedOwner,
    proxySourceHash: proxySourceEvidence.combinedSourceHash,
    oldSourceHash: oldSourceEvidence.combinedSourceHash,
    workflowCodeHash: sha256(fs.readFileSync(__filename)),
    runState: path.resolve(options.runState),
    evidenceOutput: path.resolve(options.evidenceOutput),
  };
  const context = await prepareContext({
    ...options,
    script: "deploy-yield-vault-old-proxy",
    mode: "deploy-old-proxy",
    expectedOwner,
    configuration,
    deadline,
  }, {
    schemaVersion: 2,
    type: "yield-vault-old-proxy-deployment",
    source: {
      proxy: proxySourceEvidence,
      oldImplementation: oldSourceEvidence,
    },
  }, dependencies);
  try {
    const proxyCheckpoint = await executeOperation(
      context,
      "deploy-proxy",
      deploySpec(context, "Proxy", proxySource, {
        _logicContract: DEAD_BEEF.padStart(40, "0"),
        _initialOwner: expectedOwner,
      }, proxySourceEvidence),
      deadline
    );
    const proxyAddress = proxyCheckpoint.result.address;
    context.journal.updateEvidence({
      proxy: {
        address: proxyAddress,
        ...submissionEvidence(proxyCheckpoint),
        creationReceipt: proxyCheckpoint.result.creationReceipt,
        receiptCreatedAddress: proxyCheckpoint.result.address,
      },
    });

    const implementationCheckpoint = await executeOperation(
      context,
      "deploy-old-implementation",
      deploySpec(context, "YieldVault", oldSource, {
        initialOwner: DEAD_BEEF.padStart(40, "0"),
      }, oldSourceEvidence),
      deadline
    );
    const implementationAddress = implementationCheckpoint.result.address;
    context.journal.updateEvidence({
      implementation: {
        address: implementationAddress,
        ...submissionEvidence(implementationCheckpoint),
        creationReceipt: implementationCheckpoint.result.creationReceipt,
        receiptCreatedAddress: implementationCheckpoint.result.address,
      },
    });

    let activation = context.journal.state.checkpoints["activate-old-implementation"];
    if (!activation || ["ready"].includes(activation.status)) {
      const proxyIdentity = await readProxyIdentity(
        context.owner.token,
        proxyAddress,
        dependencies
      );
      if (proxyIdentity.logicContract !== normalizeAddress(DEAD_BEEF.padStart(40, "0"))) {
        throw new Error(`Empty Proxy has unexpected logic pointer ${proxyIdentity.logicContract}`);
      }
      if (proxyIdentity.proxyOwner !== expectedOwner) {
        throw new Error(
          `Empty Proxy owner ${proxyIdentity.proxyOwner} does not match ${expectedOwner}`
        );
      }
    }
    const preSnapshot = activation && activation.readyEvidence &&
      activation.readyEvidence.preSnapshot || {
        implementation: normalizeAddress(DEAD_BEEF.padStart(40, "0")),
        owner: expectedOwner,
      };
    activation = await executeOperation(
      context,
      "activate-old-implementation",
      {
        operation: "activate YieldVaultOld through Proxy",
        signer: context.owner,
        onlyOwner: true,
        governed: true,
        registryContract: "Proxy",
        method: "setLogicContract",
        submissionEvidence: {
          signer: signerIdentity(context.owner),
          proxyAddress,
          method: "setLogicContract",
          implementationAddress,
        },
        readyEvidence: {
          network: context.network,
          expectedOwner,
          preSnapshot,
        },
        mayGovern: true,
        governancePayload: {
          target: proxyAddress,
          func: "setLogicContract",
          args: [implementationAddress],
        },
        matchesRawTransaction(row) {
          const payload = {
            target: proxyAddress,
            func: "setLogicContract",
            args: [implementationAddress],
          };
          const logical = rawLogicalPayload(row);
          return rawSignerMatches(row, context.owner) &&
            (Boolean(logical && logical.target === payload.target &&
            logical.func === payload.func &&
            operationArgsMatch(logical.args, payload.args)) ||
            rawMatchesGovernance(row, payload));
        },
        discoverGovernanceAfterCompletion: true,
        async receiptProvesCompletion() {
          const identity = await readIdentity(
            context.owner.token,
            proxyAddress,
            dependencies,
            { allowUninitialized: true }
          );
          return identity.logicContract === implementationAddress;
        },
        submit: () => dependencies.rest.call(
          context.owner.token,
          callArgs(proxyAddress, implementationAddress),
          { config: runtime.config, cacheNonce: false, isAsync: true }
        ),
        async confirm({ deadline: confirmationDeadline }) {
          let identity;
          do {
            identity = await readIdentity(
              context.owner.token,
              proxyAddress,
              dependencies,
              { allowUninitialized: true }
            );
            if (identity.logicContract === implementationAddress) break;
            await dependencies.sleep(
              Math.min(
                dependencies.pollMs,
                Math.max(1, confirmationDeadline - Date.now())
              )
            );
          } while (Date.now() < confirmationDeadline);
          if (identity.logicContract !== implementationAddress) {
            throw new WorkflowStop(
              "activate-old-implementation",
              "timeout",
              null,
              identity
            );
          }
          if (identity.proxyOwner !== expectedOwner || identity.owner !== expectedOwner) {
            throw new Error("Activated YieldVaultOld owner does not match expected owner");
          }
          return {
            proxyAddress,
            confirmedImplementation: implementationAddress,
            postIdentity: identity,
          };
        },
        async revalidate() {
          const identity = await readIdentity(
            context.owner.token,
            proxyAddress,
            dependencies,
            { allowUninitialized: true }
          );
          if (identity.logicContract !== implementationAddress ||
              identity.proxyOwner !== expectedOwner || identity.owner !== expectedOwner) {
            throw new Error("Confirmed old implementation activation no longer matches live state");
          }
        },
      },
      deadline
    );
    context.journal.updateEvidence({
      activation: {
        proxyAddress,
        implementationAddress,
        confirmedImplementation: activation.result.confirmedImplementation,
        ...submissionEvidence(activation),
        activationReceipt:
          activation.governanceExecutionReceipt || activation.receipt,
      },
      addresses: {
        VAULT_PROXY: proxyAddress,
        OLD_IMPLEMENTATION: implementationAddress,
      },
    });
    context.journal.state.completed = true;
    context.journal.save();
    console.log(
      `YIELD_VAULT_OLD_PROXY_COMPLETE proxy=${proxyAddress} ` +
      `implementation=${implementationAddress} evidence=${context.journal.evidencePath}`
    );
    return context.journal.evidence();
  } catch (error) {
    if (error instanceof WorkflowStop) context.journal.interrupt(error);
    throw error;
  } finally {
    context.journal.release();
  }
}

async function runSafeUpgrade(options, overrides = {}) {
  const deadline = Date.now() + (options.deadlineMs || DEFAULT_DEADLINE_MS);
  const dependencies = defaultDependencies(overrides);
  const rollback = options.rollback === true;
  let source = null;
  let sourceEvidence = null;
  if (!rollback) {
    const contractsDir = runtime.config.resolvePath(runtime.config.contractsDir);
    source = await combineReviewedSource(
      path.join(contractsDir, "BaseCodeCollection.sol"),
      dependencies.combine
    );
    sourceEvidence = verifyReviewedSource(
      source,
      options.expectedReviewedSourceHash,
      "EXPECTED_REVIEWED_SOURCE_HASH"
    );
  }
  const expectedOwner = normalizeAddress(options.expectedOwner, "expected owner");
  const proxyAddress = normalizeAddress(options.proxyAddress, "proxy address");
  const expectedCurrentImplementation = normalizeAddress(
    rollback ? options.expectedCurrentImplementation : options.expectedOldImplementation,
    rollback ? "expected current implementation" : "expected old implementation"
  );
  const rollbackImplementation = rollback
    ? normalizeAddress(options.implementationAddress, "rollback implementation address")
    : null;
  const configuration = {
    rollback,
    expectedOwner,
    proxyAddress,
    expectedCurrentImplementation,
    implementationAddress: rollbackImplementation,
    sourceHash: sourceEvidence && sourceEvidence.combinedSourceHash,
    workflowCodeHash: sha256(fs.readFileSync(__filename)),
    runState: path.resolve(options.runState),
    evidenceOutput: path.resolve(options.evidenceOutput),
  };
  const context = await prepareContext({
    ...options,
    script: "safe-upgrade-yield-vault",
    mode: rollback ? "rollback" : "upgrade",
    expectedOwner,
    requireDeployer: !rollback,
    configuration,
    deadline,
  }, {
    schemaVersion: 1,
    type: "proxy-upgrade-evidence",
    mode: rollback ? "rollback" : "upgrade",
    source: sourceEvidence
      ? {
          combinedSourceHash: sourceEvidence.combinedSourceHash,
          reviewedSourceHash: sourceEvidence.expectedReviewedSourceHash,
          file: sourceEvidence.file,
        }
      : null,
    proxyAddress,
    expectedOwner,
    expectedCurrentImplementation,
  }, dependencies);
  try {
    const pointerCheckpointId = rollback ? "rollback-pointer" : "upgrade-pointer";
    const pointerEntry = context.journal.state.checkpoints[pointerCheckpointId];
    const expectedLiveImplementation = pointerEntry &&
      ["submitted", "confirmed"].includes(pointerEntry.status)
      ? [expectedCurrentImplementation,
          checkpointResult(context.journal, "deploy-new-implementation") &&
            checkpointResult(context.journal, "deploy-new-implementation").address,
          rollbackImplementation].filter(Boolean)
      : [expectedCurrentImplementation];
    const initialIdentity = await readIdentity(context.owner.token, proxyAddress, dependencies);
    if (!expectedLiveImplementation.includes(initialIdentity.logicContract)) {
      throw new Error(
        `Proxy logic pointer mismatch: live=${initialIdentity.logicContract} ` +
        `expected=${expectedLiveImplementation.join(" or ")}`
      );
    }
    validateIdentity(initialIdentity, {
      implementation: initialIdentity.logicContract,
      owner: expectedOwner,
      paused: true,
    });
    const initialSnapshot = await captureVault(
      context.owner,
      proxyAddress,
      initialIdentity.asset,
      dependencies
    );
    context.journal.updateEvidence({
      preconditions: {
        checked: true,
        identity: initialIdentity,
        snapshot: initialSnapshot,
      },
    });

    let implementationAddress = rollbackImplementation;
    if (!rollback) {
      const implementationCheckpoint = await executeOperation(
        context,
        "deploy-new-implementation",
        deploySpec(context, "YieldVault", source, {
          initialOwner: DEAD_BEEF.padStart(40, "0"),
        }, sourceEvidence),
        deadline
      );
      implementationAddress = implementationCheckpoint.result.address;
      context.journal.updateEvidence({
        implementation: {
          address: implementationAddress,
          ...submissionEvidence(implementationCheckpoint),
          creationReceipt: implementationCheckpoint.result.creationReceipt,
          receiptCreatedAddress: implementationAddress,
        },
      });
    }

    let pointerEntryNow = context.journal.state.checkpoints[pointerCheckpointId];
    const preSnapshot = pointerEntryNow && pointerEntryNow.readyEvidence &&
      pointerEntryNow.readyEvidence.preSnapshot || initialSnapshot;
    if (!pointerEntryNow || pointerEntryNow.status === "ready") {
      const beforePointer = await readIdentity(context.owner.token, proxyAddress, dependencies);
      validateIdentity(beforePointer, {
        implementation: expectedCurrentImplementation,
        owner: expectedOwner,
        paused: true,
      });
    }
    pointerEntryNow = await executeOperation(
      context,
      pointerCheckpointId,
      pointerSpec(context, {
        operation: rollback ? "rollback Proxy logic pointer" : "upgrade Proxy logic pointer",
        proxyAddress,
        implementationAddress,
        expectedCurrentImplementation,
        expectedOwner,
        preIdentity: initialIdentity,
        preSnapshot,
        requirePaused: true,
        rollback,
        deadline,
      }),
      deadline
    );
    const upgradeRecord = {
      proxyAddress,
      previousImplementation: expectedCurrentImplementation,
      newImplementation: implementationAddress,
      confirmedImplementation: pointerEntryNow.result.confirmedImplementation,
      upgradeSubmission: submissionEvidence(pointerEntryNow),
      governance: submissionEvidence(pointerEntryNow).governance,
      preSnapshot,
      postSnapshot: pointerEntryNow.result.postSnapshot,
      invariantsPreserved: true,
    };
    context.journal.updateEvidence({
      implementation: rollback
        ? { address: implementationAddress, deployedByWorkflow: false }
        : context.journal.state.evidence.implementation,
      upgrades: [upgradeRecord],
      rollback: rollback
        ? {
            guarded: true,
            deployedImplementation: false,
            expectedCurrentImplementation,
            restoredImplementation: implementationAddress,
            comparison: pointerEntryNow.result.rollbackComparison,
          }
        : null,
    });
    context.journal.state.completed = true;
    context.journal.save();
    console.log(
      `${rollback ? "YIELD_VAULT_ROLLBACK_COMPLETE" : "YIELD_VAULT_SAFE_UPGRADE_COMPLETE"} ` +
      `proxy=${proxyAddress} implementation=${implementationAddress} ` +
      `evidence=${context.journal.evidencePath}`
    );
    return context.journal.evidence();
  } catch (error) {
    if (error instanceof WorkflowStop) context.journal.interrupt(error);
    throw error;
  } finally {
    context.journal.release();
  }
}

module.exports = {
  DEAD_BEEF,
  DEFAULT_DEADLINE_MS,
  PathLock,
  WorkflowJournal,
  WorkflowStop,
  APPENDED_VAULT_FIELDS,
  assertInvariants,
  appendedVaultState,
  combineReviewedSource,
  combinedSourceText,
  createdAddress,
  defaultDependencies,
  issueId,
  parseArgs,
  readIdentity,
  readProxyIdentity,
  requireArguments,
  requireOnlyArguments,
  runDeployOldProxy,
  runSafeUpgrade,
  submittedSourceHash,
  transactionHash,
  verifyReviewedSource,
};
