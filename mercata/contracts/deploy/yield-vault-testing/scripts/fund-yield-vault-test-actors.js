#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const axios = require("axios");
const { rest } = require("blockapps-rest");

const {
  atomicWriteJson,
  config,
  envFile,
  fetchExpectedTestnetNetwork,
  optionalEnv,
  pollUntil,
  requiredEnv,
  rootNodeUrl,
} = require("./runtime");
const {
  normalizeAddress: normalizeAnyAddress,
  parseFeePolicyEvidence,
  parseStoredAddress,
  reviewedPolicyForNetwork,
} = require("./fee-policy");
const auth = require("../../auth");
const {
  CheckpointStop,
  findIssueCreated,
  findIssueExecution,
  externalGovernanceExecutionReconciliation,
  sameTransactionHash,
  readAccountSubmissionState,
  readAdminMembership,
  authenticateActors,
  validateStorageOwnerAuthority,
  approveGovernedSubmission,
  ADMIN_REGISTRY,
} = require("./common");
const {
  PathLock,
} = require("./upgrade-safety");
const {
  positionalArguments,
  registeredCheckpoint,
} = require("./only-owner-registry");

const SCRIPT_VERSION = "2.0.0";
const SCHEMA_VERSION = 2;
const U = 10n ** 18n;
const ZERO_ADDRESS = "0".repeat(40);
const ADDRESS_RE = /^[0-9a-f]{40}$/;
const REQUIRED_RUNS = 10;
const EXPECTED_DECIMALS = 18;

const REQUIRED_ROLES = [
  "MINTER",
  "OWNER",
  "ALICE",
  "BOB",
  "CAROL",
  "STRATEGY",
  "LOSS_SINK",
  "SMOKE_USER",
  "REWARD_DISTRIBUTOR",
  "DONOR",
  "DAVE",
];

const UNDERLYING_PER_RUN = {
  ALICE: 200n * U,
  BOB: 150n * U,
  CAROL: 100n * U,
  STRATEGY: 30n * U,
  SMOKE_USER: 10n * U,
  REWARD_DISTRIBUTOR: 30n * U,
  DONOR: 5n * U,
  DAVE: 25n * U,
};

const FEE_FOR_TEN_RUNS = {
  MINTER: 2n * U,
  OWNER: 10n * U,
  ALICE: 2n * U,
  BOB: 2n * U,
  CAROL: 2n * U,
  STRATEGY: 2n * U,
  LOSS_SINK: 0n,
  SMOKE_USER: 2n * U,
  REWARD_DISTRIBUTOR: 2n * U,
  DONOR: 2n * U,
  DAVE: 2n * U,
};

function normalizeAddress(value, label) {
  const address = String(value == null ? "" : value);
  if (!ADDRESS_RE.test(address) || address === ZERO_ADDRESS) {
    throw new Error(`${label} must be a nonzero lowercase 40-hex address without 0x`);
  }
  return address;
}

function bigint(value, label) {
  try {
    return BigInt(String(value));
  } catch {
    throw new Error(`${label} is not an integer: ${value}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

function hashObject(value) {
  return sha256(JSON.stringify(stableValue(value)));
}

function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${label} ${filePath}: ${error.message}`);
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${filePath}: ${error.message}`);
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (!["asset", "fee-token", "runs", "actors", "output"].includes(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (values[key] !== undefined) throw new Error(`Duplicate argument: ${argument}`);
    values[key] = value;
    index++;
  }
  for (const key of ["asset", "fee-token", "runs", "actors", "output"]) {
    if (!values[key]) throw new Error(`Missing required argument: --${key}`);
  }
  const runs = Number(values.runs);
  if (!Number.isSafeInteger(runs) || runs < REQUIRED_RUNS) {
    throw new Error(`--runs must be a safe integer >= ${REQUIRED_RUNS}`);
  }
  return {
    asset: normalizeAddress(values.asset, "--asset"),
    feeToken: normalizeAddress(values["fee-token"], "--fee-token"),
    runs,
    actorsPath: path.resolve(values.actors),
    outputPath: path.resolve(values.output),
  };
}

function printUsage() {
  console.error(
    "Usage: node fund-yield-vault-test-actors.js " +
      "--asset <ADDRESS> --fee-token <ADDRESS> --runs <N>=10 " +
      "--actors <actors.json> --output <funding-manifest.json>"
  );
}

function validateActorDistinctness(actors) {
  const byAddress = {};
  for (const [role, address] of Object.entries(actors)) {
    byAddress[address] = byAddress[address] || [];
    byAddress[address].push(role);
  }
  const overlaps = [];
  for (const [address, roles] of Object.entries(byAddress)) {
    if (roles.length < 2) continue;
    if (roles.length !== 2 || !roles.includes("MINTER") || !roles.includes("OWNER")) {
      throw new Error(`Actor roles must be distinct except MINTER may equal OWNER: ${roles.join(", ")}`);
    }
    overlaps.push({ address, roles: ["MINTER", "OWNER"] });
  }
  return overlaps;
}

function loadActors(actorsPath) {
  const file = readJson(actorsPath, "actors file");
  if (file.value.schemaVersion !== 2) {
    throw new Error("Actors JSON schemaVersion must be 2");
  }
  if (typeof file.value.expectedNetworkID !== "string" ||
      !/^\d+$/.test(file.value.expectedNetworkID)) {
    throw new Error("Actors JSON expectedNetworkID must be a decimal string");
  }
  const source = file.value.actors;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Actors JSON must be an object or contain an actors object");
  }
  for (const obsolete of ["STRATEGY_A", "STRATEGY_B", "FEE_FUNDER", "FEE_TOKEN_AUTHORITY"]) {
    if (source[obsolete] !== undefined) {
      throw new Error(`Actors file uses obsolete role ${obsolete}; use singular STRATEGY and MINTER`);
    }
  }
  const actors = Object.fromEntries(
    REQUIRED_ROLES.map((role) => {
      const entry = source[role];
      const address = typeof entry === "string" ? entry : entry && entry.address;
      if (!address) throw new Error(`Actors file is missing ${role}`);
      return [role, normalizeAddress(address, `actors.${role}`)];
    })
  );
  return {
    actors,
    overlaps: validateActorDistinctness(actors),
    hash: sha256(file.raw),
    expectedNetworkID: file.value.expectedNetworkID,
  };
}

async function authenticateMinter(expectedAddress) {
  const configuredAddress = normalizeAddress(requiredEnv("MINTER_ADDRESS"), "MINTER_ADDRESS");
  if (configuredAddress !== expectedAddress) {
    throw new Error(`MINTER_ADDRESS does not match actors file: ${configuredAddress} != ${expectedAddress}`);
  }
  const token = await auth.getUserToken(
    requiredEnv("MINTER_USERNAME"),
    requiredEnv("MINTER_PASSWORD")
  );
  if (!token) throw new Error("MINTER authentication returned no token");
  const authenticatedAddress = normalizeAddress(
    await rest.getKey({ token }, { config }),
    "MINTER authenticated key"
  );
  if (authenticatedAddress !== expectedAddress) {
    throw new Error(
      `MINTER credentials resolve to ${authenticatedAddress || "unknown"}, expected ${expectedAddress}`
    );
  }
  return { token: { token }, address: authenticatedAddress };
}

function ceilScaled(baseForTenRuns, runs) {
  return (baseForTenRuns * BigInt(runs) + 9n) / 10n;
}

function buildTargets(actors, runs) {
  const underlyingByRole = Object.fromEntries(
    Object.entries(UNDERLYING_PER_RUN).map(([role, amount]) => [
      role,
      amount * BigInt(runs),
    ])
  );
  const feeByRole = Object.fromEntries(
    Object.entries(FEE_FOR_TEN_RUNS).map(([role, amount]) => [
      role,
      role === "MINTER" && actors.MINTER === actors.OWNER ? 0n : ceilScaled(amount, runs),
    ])
  );
  const feeByAddress = {};
  for (const role of REQUIRED_ROLES) {
    const amount = feeByRole[role];
    if (amount === 0n) continue;
    const address = actors[role];
    if (feeByAddress[address] === undefined || amount > feeByAddress[address].amount) {
      feeByAddress[address] = { amount, roles: [role] };
    } else if (amount === feeByAddress[address].amount) {
      feeByAddress[address].roles.push(role);
    }
  }
  return { underlyingByRole, feeByRole, feeByAddress };
}

function buildMintPlan(asset, feeToken, actors, runs) {
  const targets = buildTargets(actors, runs);
  const entries = new Map();
  const feeKeys = [];
  const add = (token, recipient, amount, contribution) => {
    if (amount === 0n) return;
    const key = `${token}:${recipient}`;
    if (!entries.has(key)) {
      entries.set(key, { token, recipient, amount: 0n, contributions: [] });
    }
    const entry = entries.get(key);
    entry.amount += amount;
    entry.contributions.push({ ...contribution, amount });
    return key;
  };

  const minterFee = targets.feeByAddress[actors.MINTER];
  if (!minterFee) throw new Error("The aggregated fee plan must include MINTER");
  feeKeys.push(
    add(feeToken, actors.MINTER, minterFee.amount, {
      kind: "fee",
      roles: minterFee.roles,
    })
  );
  for (const [recipient, target] of Object.entries(targets.feeByAddress)) {
    if (recipient === actors.MINTER) continue;
    feeKeys.push(
      add(feeToken, recipient, target.amount, { kind: "fee", roles: target.roles })
    );
  }

  const underlyingOnlyKeys = [];
  for (const [role, amount] of Object.entries(targets.underlyingByRole)) {
    const key = add(asset, actors[role], amount, { kind: "underlying", role });
    if (!feeKeys.includes(key) && !underlyingOnlyKeys.includes(key)) underlyingOnlyKeys.push(key);
  }

  const plan = [...feeKeys, ...underlyingOnlyKeys].map((key, index) => ({
    index: index + 1,
    ...entries.get(key),
  }));
  const expectedUnderlying = 550n * U * BigInt(runs);
  const configuredUnderlying = Object.values(targets.underlyingByRole).reduce(
    (sum, amount) => sum + amount,
    0n
  );
  if (configuredUnderlying !== expectedUnderlying) {
    throw new Error(`Underlying plan mismatch: ${configuredUnderlying} != ${expectedUnderlying}`);
  }
  return { plan, targets, expectedUnderlying };
}

function assertDirectMintAuthority(token, minter) {
  if (token.owner !== minter) {
    throw new Error(
      `MINTER ${minter} is not direct mint authority for token ${token.address}; owner=${token.owner}`
    );
  }
  return { mode: "direct-owner", address: minter, token: token.address };
}

function assertMintAuthority(token, minter, adminMembership = null) {
  if (token.owner === minter) return assertDirectMintAuthority(token, minter);
  if (token.owner !== ADMIN_REGISTRY) {
    throw new Error(
      `MINTER ${minter} cannot mint token ${token.address}; storage owner=${token.owner}`
    );
  }
  const membership = bigint(adminMembership, "MINTER AdminRegistry.adminMap membership");
  if (membership <= 0n) {
    throw new Error(`MINTER ${minter} is not a live AdminRegistry admin`);
  }
  return {
    mode: "admin-registry",
    address: minter,
    token: token.address,
    storageOwner: token.owner,
    adminRegistry: ADMIN_REGISTRY,
    adminMapMembership: membership,
  };
}

async function authenticatedGet(url, tokenObj, params) {
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
    params,
  });
  return response.data;
}

async function cirrusGet(tokenObj, table, params) {
  return authenticatedGet(
    `${rootNodeUrl()}/cirrus/search/${encodeURIComponent(table)}`,
    tokenObj,
    params
  );
}

async function getTokenMetadata(tokenObj, address) {
  const rows = await cirrusGet(tokenObj, "BlockApps-Token", {
    address: `eq.${address}`,
    select: "address,_owner,_name,_symbol,customDecimals,_totalSupply::text",
    limit: "1",
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`Token ${address} was not found in BlockApps-Token`);
  }
  const row = rows[0];
  return {
    address,
    owner: normalizeAnyAddress(row._owner, `Token(${address})._owner`),
    name: String(row._name || ""),
    symbol: String(row._symbol || ""),
    decimals: Number(row.customDecimals),
    totalSupply: bigint(row._totalSupply || "0", `Token(${address})._totalSupply`),
  };
}

async function getBalance(tokenObj, tokenAddress, recipient) {
  const rows = await cirrusGet(tokenObj, "BlockApps-Token-_balances", {
    address: `eq.${tokenAddress}`,
    key: `eq.${recipient}`,
    select: "balance:value::text",
    limit: "1",
  });
  return bigint(rows && rows[0] ? rows[0].balance : "0", "token balance");
}

async function getLatestBlock(tokenObj) {
  const blocks = await authenticatedGet(
    `${rootNodeUrl()}/strato-api/eth/v1.2/block/last/1`,
    tokenObj
  );
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error("Could not read latest STRATO block");
  }
  const block = blocks[0];
  const number =
    block.number ?? block.blockNumber ?? block.blockDataRefNumber ?? block.blockData?.number;
  if (number === undefined || number === null) {
    throw new Error("Latest STRATO block response has no block number");
  }
  return {
    number: String(number),
    hash: block.hash || block.blockHash || null,
    timestamp: block.timestamp || block.blockTimestamp || null,
  };
}

async function readFeePolicyEvidence(tokenObj, networkID, requestedFeeToken) {
  const policy = reviewedPolicyForNetwork(networkID);
  const storageParams = {
    address: policy.stateAddress,
    key: "currentFeeContract",
    limit: "2",
  };
  const storageRows = await authenticatedGet(
    `${rootNodeUrl()}/strato-api/eth/v1.2/storage`,
    tokenObj,
    storageParams
  );
  if (!Array.isArray(storageRows) || storageRows.length !== 1) {
    throw new Error("Expected exactly one live currentFeeContract storage row");
  }
  const activeFeeContract = parseStoredAddress(storageRows[0].value);
  const accountParams = { address: activeFeeContract, limit: "2" };
  const accountRows = await authenticatedGet(
    `${rootNodeUrl()}/strato-api/eth/v1.2/account`,
    tokenObj,
    accountParams
  );
  return {
    verifiedAt: new Date().toISOString(),
    endpoints: {
      storage: { path: "/strato-api/eth/v1.2/storage", params: storageParams },
      account: { path: "/strato-api/eth/v1.2/account", params: accountParams },
    },
    ...parseFeePolicyEvidence(networkID, storageRows, accountRows, requestedFeeToken),
  };
}

function receiptHash(value) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    const hash =
      item && (item.hash || item.transactionHash || item.txHash || item.txResult?.transactionHash);
    if (hash) return String(hash);
  }
  return null;
}

async function getReceipt(tokenObj, transactionHash) {
  try {
    const results = await rest.getBlocResults(tokenObj, [transactionHash], {
      config,
      isAsync: true,
    });
    return Array.isArray(results) ? results[0] || null : results || null;
  } catch (error) {
    if (error.response && error.response.status === 404) return null;
    throw error;
  }
}

async function getTransferEvents(tokenObj, tokenAddress, transactionHash) {
  const rows = await cirrusGet(tokenObj, "event", {
    address: `eq.${tokenAddress}`,
    transaction_hash: `eq.${transactionHash}`,
    event_name: "eq.Transfer",
    order: "block_number.asc,event_index.asc",
    limit: "100",
  });
  return Array.isArray(rows)
    ? rows.map((row) => ({
        ...row,
        ...(row.attributes && typeof row.attributes === "object" ? row.attributes : {}),
      }))
    : [];
}

function eventField(event, names) {
  for (const name of names) {
    if (event && event[name] !== undefined && event[name] !== null) return event[name];
  }
  return "";
}

function assertMintEvent(events, recipient, amount) {
  const matching = events.filter((event) => {
    const from = String(eventField(event, ["from", "_from", "sender"]))
      .replace(/^0x/i, "")
      .toLowerCase();
    const to = String(eventField(event, ["to", "_to", "recipient"]))
      .replace(/^0x/i, "")
      .toLowerCase();
    const value = String(eventField(event, ["value", "_value", "amount"]));
    return from === ZERO_ADDRESS && to === recipient && value === amount.toString();
  });
  if (matching.length !== 1) {
    throw new Error(
      `Expected one exact mint event to=${recipient} amount=${amount}, found ${matching.length}`
    );
  }
}

async function pollMintCompletion(read, options = {}) {
  return pollUntil(read, (value) => value.complete, {
    intervalMs: options.intervalMs == null
      ? Number(optionalEnv("YIELD_VAULT_POLL_INTERVAL_MS", "2000"))
      : options.intervalMs,
    timeoutMs: options.timeoutMs == null ? 60000 : options.timeoutMs,
    timeoutMessage: options.timeoutMessage || "Receipt/Cirrus mint post-state timed out",
  });
}

async function snapshotPlan(tokenObj, plan, tokenAddresses) {
  const balances = {};
  for (const entry of plan) {
    balances[`${entry.token}:${entry.recipient}`] = (
      await getBalance(tokenObj, entry.token, entry.recipient)
    ).toString();
  }
  const tokens = {};
  for (const address of tokenAddresses) {
    tokens[address] = await getTokenMetadata(tokenObj, address);
  }
  return { balances, tokens };
}

function validateTokenConfiguration(asset, feeToken, minter, adminMembership = null) {
  if (asset.decimals !== EXPECTED_DECIMALS) {
    throw new Error(`Underlying decimals must be 18, got ${asset.decimals}`);
  }
  if (feeToken.decimals !== EXPECTED_DECIMALS) {
    throw new Error(`Fee-token decimals must be 18, got ${feeToken.decimals}`);
  }
  return {
    asset: assertMintAuthority(asset, minter, adminMembership),
    feeToken: assertMintAuthority(feeToken, minter, adminMembership),
  };
}

function deriveFeePayment(minterFeeBalanceBefore, minterFeeBalanceAfter, grossMintToMinter, reviewedFee) {
  const debit =
    bigint(minterFeeBalanceBefore, "MINTER fee-token balance before") +
    bigint(grossMintToMinter, "gross fee-token mint to MINTER") -
    bigint(minterFeeBalanceAfter, "MINTER fee-token balance after");
  const expectedFee = bigint(reviewedFee, "reviewed transaction fee");
  if (debit !== 0n && debit !== expectedFee) {
    throw new Error(
      `MINTER fee-token debit must be zero or reviewed fee ${expectedFee}, observed ${debit}`
    );
  }
  return {
    mode: debit === 0n ? "voucher" : "fee-token",
    debit,
    reviewedFee: expectedFee,
    grossMintToMinter: bigint(grossMintToMinter, "gross fee-token mint to MINTER"),
    minterFeeBalanceBefore: bigint(minterFeeBalanceBefore, "MINTER fee-token balance before"),
    minterFeeBalanceAfter: bigint(minterFeeBalanceAfter, "MINTER fee-token balance after"),
  };
}

class FundingJournal {
  constructor(runStatePath, outputPath, configuration) {
    this.path = path.resolve(runStatePath);
    this.outputPath = path.resolve(outputPath);
    this.configuration = stableValue(configuration);
    this.configurationHash = hashObject(this.configuration);
    this.locks = [this.path, this.outputPath].sort().map((file) => new PathLock(file));
    this.state = null;
  }

  acquire() {
    try {
      for (const lock of this.locks) lock.acquire();
      if (fs.existsSync(this.path)) {
        this.state = readJson(this.path, "funding run-state").value;
        if (this.state.configurationHash !== this.configurationHash) {
          const priorComparable = { ...stableValue(this.state.configuration) };
          const currentComparable = { ...stableValue(this.configuration) };
          for (const key of ["scriptHash", "approver", "approverAuthority"]) {
            delete priorComparable[key];
            delete currentComparable[key];
          }
          if (JSON.stringify(priorComparable) !== JSON.stringify(currentComparable)) {
            throw new Error("Existing funding run-state configuration does not match this invocation");
          }
          this.state.configurationMigration = {
            type: "automatic-governance-approver",
            previousConfigurationHash: this.state.configurationHash,
            previousScriptHash: this.state.configuration && this.state.configuration.scriptHash,
            migratedAt: new Date().toISOString(),
          };
          this.state.configuration = this.configuration;
          this.state.configurationHash = this.configurationHash;
        }
      } else {
        this.state = {
          schemaVersion: 1,
          type: "yield-vault-funding-run-state",
          createdAt: new Date().toISOString(),
          configuration: this.configuration,
          configurationHash: this.configurationHash,
          checkpoints: {},
          interruptions: [],
          completed: false,
        };
      }
      this.save();
    } catch (error) {
      this.release();
      throw error;
    }
  }

  save() {
    this.state.updatedAt = new Date().toISOString();
    atomicWriteJson(this.path, this.state);
  }

  transition(id, status, details = {}) {
    this.state.checkpoints[id] = {
      ...(this.state.checkpoints[id] || {}),
      ...stableValue(details),
      checkpointId: id,
      status,
      [`${status}At`]: new Date().toISOString(),
    };
    this.save();
    return this.state.checkpoints[id];
  }

  updateSubmitted(id, details = {}) {
    return this.transition(id, "submitted", details);
  }

  interrupt(error) {
    this.state.interruptions.push({
      checkpointId: error.checkpoint,
      reason: error.reason,
      transactionHash: error.txHash,
      latestStatus: error.latestStatus,
      at: new Date().toISOString(),
    });
    this.save();
  }

  release() {
    for (const lock of [...this.locks].reverse()) lock.release();
  }
}

function fundingRunStatePath(outputPath) {
  return `${path.resolve(outputPath)}.run-state.json`;
}

async function pollTerminalReceipt(tokenObj, transactionHash, deadline) {
  let receipt = null;
  while (Date.now() < deadline) {
    receipt = await getReceipt(tokenObj, transactionHash);
    if (receipt && receipt.status && receipt.status !== "Pending") return receipt;
    await new Promise((resolve) => setTimeout(
      resolve,
      Math.min(
        Number(optionalEnv("YIELD_VAULT_POLL_INTERVAL_MS", "2000")),
        Math.max(1, deadline - Date.now())
      )
    ));
  }
  return receipt;
}

async function executeMint(context, entry) {
  const {
    tokenObj,
    network,
    minter,
    journal,
    governed,
    approver,
    approverAuthority,
  } = context;
  const checkpoint = `mint-${entry.index}`;
  if (!registeredCheckpoint("funding", checkpoint, "Token", "mint")) {
    throw new Error(`Funding checkpoint ${checkpoint} is not in the onlyOwner registry`);
  }
  let saved = journal.state.checkpoints[checkpoint];
  if (saved && saved.status === "confirmed") return saved.result;
  const deadline = Date.now() + (context.deadlineMs || 60_000);
  let minterFeeBalanceBefore;
  let balanceBefore;
  let tokenBefore;
  let feePolicyEvidence;
  if (!saved) {
    minterFeeBalanceBefore = await getBalance(tokenObj, network.feeToken, minter);
    balanceBefore =
      entry.token === network.feeToken && entry.recipient === minter
        ? minterFeeBalanceBefore
        : await getBalance(tokenObj, entry.token, entry.recipient);
    tokenBefore = await getTokenMetadata(tokenObj, entry.token);
    feePolicyEvidence = await readFeePolicyEvidence(
      tokenObj,
      network.networkID,
      network.feeToken
    );
    const account = await readAccountSubmissionState(tokenObj, minter);
    const governancePayload = {
      target: entry.token,
      func: "mint",
      args: positionalArguments("Token", "mint", {
        to: entry.recipient,
        amount: entry.amount.toString(),
      }),
    };
    journal.transition(checkpoint, "ready", {
      operation: "Token.mint",
      onlyOwner: true,
      governed,
      registryContract: "Token",
      actor: "MINTER",
      actorAddress: minter,
      token: entry.token,
      recipient: entry.recipient,
      amount: entry.amount,
      arguments: { to: entry.recipient, amount: entry.amount.toString() },
      contributions: entry.contributions,
      preSubmissionSequence: account.sequence,
      preSubmissionAccountEvidence: account,
      before: {
        balance: balanceBefore,
        totalSupply: tokenBefore.totalSupply,
        minterFeeBalance: minterFeeBalanceBefore,
      },
      feePolicyEvidence,
      governancePayload,
    });
    saved = journal.state.checkpoints[checkpoint];
  } else {
    minterFeeBalanceBefore = bigint(saved.before.minterFeeBalance);
    balanceBefore = bigint(saved.before.balance);
    tokenBefore = { totalSupply: bigint(saved.before.totalSupply) };
    feePolicyEvidence = saved.feePolicyEvidence;
  }

  console.log(
    `MINT_ENTRY checkpoint=${checkpoint} token=${entry.token} recipient=${entry.recipient} ` +
    `amount=${entry.amount} balanceBefore=${balanceBefore} supplyBefore=${tokenBefore.totalSupply} ` +
    `minterFeeBalanceBefore=${minterFeeBalanceBefore}`
  );

  if (saved.status === "ready") {
    journal.transition(checkpoint, "dispatching", {
      submissionAttempt: Number(saved.submissionAttempt || 0) + 1,
    });
    let response;
    try {
      response = await rest.call(
        tokenObj,
        {
          contract: { address: entry.token, name: "Token" },
          method: "mint",
          args: { to: entry.recipient, amount: entry.amount.toString() },
          txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
        },
        { config, cacheNonce: false, isAsync: true }
      );
    } catch (error) {
      journal.transition(checkpoint, "dispatching", {
        submissionError: { name: error.name, message: error.message },
      });
      throw new CheckpointStop(
        checkpoint,
        "unknown_status",
        null,
        "Mint dispatch outcome is ambiguous; refusing duplicate submission",
        { message: error.message }
      );
    }
    const transactionHash = receiptHash(response);
    if (!transactionHash) {
      journal.transition(checkpoint, "dispatching", { rawSubmission: response });
      throw new CheckpointStop(
        checkpoint,
        "unknown_status",
        null,
        "Mint submission returned no transaction hash; refusing duplicate submission",
        response
      );
    }
    journal.transition(checkpoint, "submitted", {
      transactionHash,
      rawSubmission: response,
    });
    saved = journal.state.checkpoints[checkpoint];
  }
  if (saved.status === "dispatching") {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      saved.transactionHash,
      "Mint dispatch has no durable hash; manual reconciliation is required",
      saved
    );
  }

  const transactionHash = saved.transactionHash;
  let receipt = saved.receipt;
  if (!receipt || !receipt.status || receipt.status === "Pending") {
    receipt = await pollTerminalReceipt(tokenObj, transactionHash, deadline);
    journal.transition(checkpoint, "submitted", { receipt });
  }
  if (!receipt || !receipt.status || receipt.status === "Pending") {
    throw new CheckpointStop(
      checkpoint,
      "timeout",
      transactionHash,
      "Mint submission receipt remains pending",
      receipt
    );
  }
  if (receipt.status !== "Success") {
    throw new CheckpointStop(
      checkpoint,
      "failed_receipt",
      transactionHash,
      "Mint submission failed",
      receipt
    );
  }

  let effectHash = transactionHash;
  let issue = saved.governanceIssueId
    ? {
        issueId: saved.governanceIssueId,
        row: saved.governanceIssueCreatedEvent,
      }
    : null;
  let execution = saved.governanceExecution || null;
  let executionReceipt = saved.governanceExecutionReceipt || null;
  if (governed) {
    while (!issue && Date.now() < deadline) {
      issue = await findIssueCreated(tokenObj, transactionHash, saved.governancePayload);
      if (!issue) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!issue) {
      throw new CheckpointStop(
        checkpoint,
        "pending_governance",
        transactionHash,
        "Exact mint IssueCreated was not indexed",
        { governancePayload: saved.governancePayload }
      );
    }
    if (!saved.governanceIssueId) {
      journal.transition(checkpoint, "submitted", {
        governanceIssueId: issue.issueId,
        governanceIssueTarget: saved.governancePayload.target,
        governanceIssueFunction: saved.governancePayload.func,
        governanceIssueArguments: saved.governancePayload.args,
        governanceIssueCreationBlock: issue.position.block,
        governanceIssueCreationTimestamp: issue.position.timestamp,
        governanceIssueCreatedEvent: issue.row,
      });
      console.log(
        `GOVERNANCE_ISSUE checkpoint=${checkpoint} submissionHash=${transactionHash} ` +
        `issueId=${issue.issueId} target=${saved.governancePayload.target} ` +
        `func=mint args=${JSON.stringify(saved.governancePayload.args)} ` +
        `creationBlock=${issue.position.block} creationTimestamp=${issue.position.timestamp}`
      );
    }
    execution = await findIssueExecution(
      tokenObj,
      issue.issueId,
      issue.row,
      saved.governancePayload
    ) || execution;
    let approval = journal.state.checkpoints[checkpoint].governanceApproval || null;
    const externalExecution = execution &&
      (!approval || !sameTransactionHash(
        execution.transactionHash,
        approval.transactionHash
      ));
    if (externalExecution) {
      const reconciliation = externalGovernanceExecutionReconciliation(
        issue.issueId,
        execution,
        approval
      );
      journal.transition(checkpoint, "submitted", reconciliation);
      if (reconciliation.governanceCleanupRecommendation) {
        console.warn(
          `GOVERNANCE_CLEANUP_RECOMMENDED checkpoint=${checkpoint} ` +
          `issueId=${issue.issueId} approvalHash=${reconciliation
            .governanceCleanupRecommendation.redundantApprovalTransactionHash} ` +
          `action=${reconciliation.governanceCleanupRecommendation.action}`
        );
      }
    } else if (!execution) {
      approval = await approveGovernedSubmission(
        {
          actors: { APPROVER: approver },
          approverAuthority,
          journal,
          faultInjector: context.faultInjector,
        },
        checkpoint,
        {
          contractName: "Token",
          method: "mint",
          approvalArgs: {
            to: entry.recipient,
            amount: entry.amount.toString(),
          },
        },
        { address: minter, token: tokenObj },
        saved.governancePayload,
        deadline
      );
    }
    while (!execution && Date.now() < deadline) {
      execution = await findIssueExecution(
        tokenObj,
        issue.issueId,
        issue.row,
        saved.governancePayload
      );
      if (!execution) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!execution) {
      throw new CheckpointStop(
        checkpoint,
        "pending_governance",
        transactionHash,
        `Governance issue ${issue.issueId} has no exact IssueExecuted after APPROVER confirmation`,
        { governanceIssueId: issue.issueId }
      );
    }
    if (!externalExecution &&
        !sameTransactionHash(execution.transactionHash, approval.transactionHash)) {
      throw new Error("Mint IssueExecuted transaction does not match the exact APPROVER mint");
    }
    journal.transition(checkpoint, "submitted", {
      governanceExecution: execution,
      governanceExecutionTransactionHash: execution.transactionHash,
      governanceExecutionSource: externalExecution
        ? "external_or_manual"
        : "automatic_approval",
    });
    effectHash = execution.transactionHash;
    if (!executionReceipt || !executionReceipt.status || executionReceipt.status === "Pending") {
      executionReceipt = await pollTerminalReceipt(tokenObj, effectHash, deadline);
      journal.transition(checkpoint, "submitted", { governanceExecutionReceipt: executionReceipt });
    }
    if (!executionReceipt || executionReceipt.status !== "Success") {
      throw new CheckpointStop(
        checkpoint,
        executionReceipt && executionReceipt.status === "Pending"
          ? "pending_governance"
          : "failed_governance_receipt",
        effectHash,
        "Mint governance execution did not succeed",
        executionReceipt
      );
    }
    console.log(
      `GOVERNANCE_EXECUTION checkpoint=${checkpoint} issueId=${issue.issueId} ` +
      `txHash=${execution.transactionHash} status=${executionReceipt.status}`
    );
  }

  const grossMintToMinter =
    entry.token === network.feeToken && entry.recipient === minter ? entry.amount : 0n;
  let latestPostEvidence = null;
  let completion;
  try {
    completion = await pollMintCompletion(
      async () => {
        const receipt = await getReceipt(tokenObj, transactionHash);
        if (!receipt || !receipt.status || receipt.status === "Pending") {
          latestPostEvidence = { complete: false, phase: "receipt", receipt };
          return latestPostEvidence;
        }
        if (receipt.status !== "Success") {
          latestPostEvidence = { complete: true, terminalFailure: true, receipt };
          return latestPostEvidence;
        }
        const minterFeeBalanceAfter = await getBalance(tokenObj, network.feeToken, minter);
        const balanceAfter =
          entry.token === network.feeToken && entry.recipient === minter
            ? minterFeeBalanceAfter
            : await getBalance(tokenObj, entry.token, entry.recipient);
        const tokenAfter = await getTokenMetadata(tokenObj, entry.token);
        const events = await getTransferEvents(tokenObj, entry.token, effectHash);
        const balanceDelta = balanceAfter - balanceBefore;
        const supplyDelta = tokenAfter.totalSupply - tokenBefore.totalSupply;
        let feePayment = null;
        let validationError = null;
        try {
          feePayment = deriveFeePayment(
            minterFeeBalanceBefore,
            minterFeeBalanceAfter,
            grossMintToMinter,
            feePolicyEvidence.verifiedFeeWei
          );
          const expectedRecipientDelta =
            entry.recipient === minter && entry.token === network.feeToken
              ? entry.amount - feePayment.debit
              : entry.amount;
          if (balanceDelta !== expectedRecipientDelta) {
            throw new Error(`recipient delta ${balanceDelta} != ${expectedRecipientDelta}`);
          }
          if (supplyDelta !== entry.amount) {
            throw new Error(`supply delta ${supplyDelta} != ${entry.amount}`);
          }
          assertMintEvent(events, entry.recipient, entry.amount);
        } catch (error) {
          validationError = error.message;
        }
        latestPostEvidence = {
          complete: validationError == null,
          phase: "cirrus-post-state",
          receipt,
          minterFeeBalanceAfter,
          balanceAfter,
          tokenAfter,
          balanceDelta,
          supplyDelta,
          feePayment,
          events,
          validationError,
        };
        return latestPostEvidence;
      }, {
        timeoutMs: Math.max(1, deadline - Date.now()),
        timeoutMessage: `Receipt/Cirrus post-state timed out for ${effectHash}`,
      }
    );
  } catch (error) {
    const evidence = JSON.stringify(
      latestPostEvidence,
      (_key, value) => typeof value === "bigint" ? value.toString() : value
    );
    throw new Error(`${error.message}; latest=${evidence}`);
  }
  if (completion.terminalFailure) {
    throw new Error(
      `Mint transaction ${transactionHash} failed with status ${completion.receipt.status}`
    );
  }
  const {
    receipt: verifiedSubmissionReceipt,
    minterFeeBalanceAfter,
    balanceAfter,
    tokenAfter,
    balanceDelta,
    supplyDelta,
    feePayment,
    events,
  } = completion;

  console.log(
    `MINT_EXIT checkpoint=${checkpoint} submissionHash=${transactionHash} effectHash=${effectHash} ` +
      `status=${(executionReceipt || verifiedSubmissionReceipt).status} ` +
      `balanceAfter=${balanceAfter} balanceDelta=${balanceDelta} ` +
      `supplyAfter=${tokenAfter.totalSupply} supplyDelta=${supplyDelta} ` +
      `feeMode=${feePayment.mode} feeDebit=${feePayment.debit} ` +
      `minterFeeBalanceAfter=${minterFeeBalanceAfter}`
  );
  const result = {
    index: entry.index,
    token: entry.token,
    recipient: entry.recipient,
    amount: entry.amount,
    contributions: entry.contributions,
    before: { balance: balanceBefore, totalSupply: tokenBefore.totalSupply },
    after: { balance: balanceAfter, totalSupply: tokenAfter.totalSupply },
    deltas: { balance: balanceDelta, totalSupply: supplyDelta },
    feePayment,
    feePolicyEvidence,
    transactionHash,
    submission: saved.rawSubmission,
    receipt: verifiedSubmissionReceipt,
    governanceIssueId: issue && issue.issueId || null,
    governanceIssueCreatedEvent: issue && issue.row || null,
    governanceApproval: journal.state.checkpoints[checkpoint].governanceApproval || null,
    governanceExecution: execution,
    governanceExecutionReceipt: executionReceipt,
    effectTransactionHash: effectHash,
    events,
  };
  journal.transition(checkpoint, "confirmed", { result });
  return result;
}

function assertFinalState(plan, initial, final, tokenAddresses, minter, feeToken, feePayments) {
  if (feePayments.length !== plan.length) {
    throw new Error(`Fee-payment evidence count ${feePayments.length} != plan length ${plan.length}`);
  }
  const totalFeeTokenDebit = feePayments.reduce(
    (sum, payment) => sum + bigint(payment.debit, "fee-token debit"),
    0n
  );
  const grossFeeTokenMintedToMinter = plan
    .filter((entry) => entry.token === feeToken && entry.recipient === minter)
    .reduce((sum, entry) => sum + entry.amount, 0n);
  for (const entry of plan) {
    const key = `${entry.token}:${entry.recipient}`;
    const delta = bigint(final.balances[key], `${key} final balance`) -
      bigint(initial.balances[key], `${key} initial balance`);
    const expected =
      entry.token === feeToken && entry.recipient === minter
        ? grossFeeTokenMintedToMinter - totalFeeTokenDebit
        : entry.amount;
    if (delta !== expected) {
      throw new Error(`Final balance delta mismatch for ${key}: ${delta} != ${expected}`);
    }
  }
  const expectedMintedByToken = Object.fromEntries(tokenAddresses.map((address) => [address, 0n]));
  for (const entry of plan) expectedMintedByToken[entry.token] += entry.amount;
  for (const address of tokenAddresses) {
    const delta =
      bigint(final.tokens[address].totalSupply, `${address} final totalSupply`) -
      bigint(initial.tokens[address].totalSupply, `${address} initial totalSupply`);
    if (delta !== expectedMintedByToken[address]) {
      throw new Error(
        `Final totalSupply delta mismatch for ${address}: ${delta} != ${expectedMintedByToken[address]}`
      );
    }
  }
  const modes = feePayments.reduce(
    (counts, payment) => {
      counts[payment.mode] = (counts[payment.mode] || 0) + 1;
      return counts;
    },
    { voucher: 0, "fee-token": 0 }
  );
  return {
    expectedMintedByToken,
    feePayments: {
      reviewedPerCallFee: feePayments[0]
        ? bigint(feePayments[0].reviewedFee, "reviewed per-call fee")
        : 0n,
      grossFeeTokenMintedToMinter,
      totalFeeTokenDebit,
      modes,
      callsVerified: feePayments.length,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const actorData = loadActors(args.actorsPath);
  const configuredAsset = optionalEnv("ASSET_ADDRESS");
  if (configuredAsset && normalizeAddress(configuredAsset, "ASSET_ADDRESS") !== args.asset) {
    throw new Error("ASSET_ADDRESS does not match --asset");
  }
  const configuredFeeToken = optionalEnv("FEE_TOKEN_ADDRESS");
  if (
    configuredFeeToken &&
    normalizeAddress(configuredFeeToken, "FEE_TOKEN_ADDRESS") !== args.feeToken
  ) {
    throw new Error("FEE_TOKEN_ADDRESS does not match --fee-token");
  }

  const minter = await authenticateMinter(actorData.actors.MINTER);
  const minterToken = minter.token;
  const approver = (await authenticateActors(["APPROVER"])).APPROVER;
  const approverAuthority = await validateStorageOwnerAuthority(
    approver,
    ADMIN_REGISTRY
  );
  const network = await fetchExpectedTestnetNetwork(minterToken);
  if (actorData.expectedNetworkID !== network.networkID) {
    throw new Error(
      `Actors JSON network mismatch: ${actorData.expectedNetworkID} != ${network.networkID}`
    );
  }
  network.feeToken = args.feeToken;
  const initialFeePolicyEvidence = await readFeePolicyEvidence(
    minterToken,
    network.networkID,
    args.feeToken
  );
  network.transactionFeeWei = initialFeePolicyEvidence.verifiedFeeWei;
  network.feeContract = initialFeePolicyEvidence.observed.feeContract;
  network.feeContractCodeHash = initialFeePolicyEvidence.observed.codeHash;

  const asset = await getTokenMetadata(minterToken, args.asset);
  const feeToken =
    args.asset === args.feeToken ? asset : await getTokenMetadata(minterToken, args.feeToken);
  const needsAdminMembership = [asset, feeToken].some((token) => token.owner === ADMIN_REGISTRY);
  const adminMembership = needsAdminMembership
    ? await readAdminMembership(minterToken, minter.address, ADMIN_REGISTRY)
    : null;
  const authorities = validateTokenConfiguration(
    asset,
    feeToken,
    actorData.actors.MINTER,
    adminMembership
  );
  if (Object.values(authorities).some((authority) => authority.mode === "admin-registry") &&
      approver.address === minter.address) {
    throw new Error("APPROVER must differ from MINTER for governed mint operations");
  }
  const { plan, targets, expectedUnderlying } = buildMintPlan(
    args.asset,
    args.feeToken,
    actorData.actors,
    args.runs
  );
  const tokenAddresses = [...new Set([args.asset, args.feeToken])];
  const scriptHash = sha256(fs.readFileSync(__filename));
  const runtimeHash = sha256(fs.readFileSync(path.join(__dirname, "runtime.js")));
  const feePolicyHash = sha256(fs.readFileSync(path.join(__dirname, "fee-policy.js")));
  const configHash = hashObject({
    envFile,
    nodeUrl: rootNodeUrl(),
    expectedNetworkID: requiredEnv("EXPECTED_NETWORK_ID"),
    expectedNetworkName: optionalEnv("EXPECTED_NETWORK_NAME"),
    requireTestnet: requiredEnv("REQUIRE_TESTNET"),
    gasPrice: config.gasPrice,
    gasLimit: config.gasLimit,
    reviewedFeePolicy: initialFeePolicyEvidence.reviewedPolicy,
  });
  const runConfiguration = {
    asset: args.asset,
    feeToken: args.feeToken,
    runs: args.runs,
    actorsHash: actorData.hash,
    expectedNetworkID: network.networkID,
    minter: minter.address,
    approver: approver.address,
    approverAuthority,
    authorities,
    plan,
    scriptHash,
  };
  const journal = new FundingJournal(
    fundingRunStatePath(args.outputPath),
    args.outputPath,
    runConfiguration
  );
  journal.acquire();
  try {
    if (fs.existsSync(args.outputPath)) {
      const outputHash = sha256(fs.readFileSync(args.outputPath));
      if (journal.state.completed !== true || journal.state.outputHash !== outputHash) {
        throw new Error("Existing funding output does not match its completed locked run-state");
      }
      const manifest = readJson(args.outputPath, "completed funding manifest").value;
      if (manifest.completed !== true ||
          manifest.runStateConfigurationHash !== journal.configurationHash) {
        throw new Error("Existing funding output is not the completed artifact for this run-state");
      }
      const live = await snapshotPlan(minterToken, plan, tokenAddresses);
      assertFinalState(
        plan,
        manifest.initial,
        live,
        tokenAddresses,
        actorData.actors.MINTER,
        args.feeToken,
        manifest.transactions.map((transaction) => transaction.feePayment)
      );
      console.log(
        `FUNDING_REASSERTED output=${args.outputPath} runState=${journal.path} ` +
        `operations=${plan.length}`
      );
      return manifest;
    }

    if (!journal.state.initial) {
      const initial = await snapshotPlan(minterToken, plan, tokenAddresses);
      const minterFeeBalance = bigint(
        initial.balances[`${args.feeToken}:${actorData.actors.MINTER}`],
        "MINTER fee-token balance"
      );
      if (minterFeeBalance < bigint(network.transactionFeeWei, "transaction fee")) {
        throw new Error(
          `MINTER bootstrap fee balance ${minterFeeBalance} is below ${network.transactionFeeWei}`
        );
      }
      journal.state.initial = initial;
      journal.state.startedAtBlock = await getLatestBlock(minterToken);
      journal.state.authorities = authorities;
      journal.save();
    }

    const authorityByToken = {
      [args.asset]: authorities.asset,
      [args.feeToken]: authorities.feeToken,
    };
    const transactions = [];
    for (const entry of plan) {
      transactions.push(await executeMint({
        tokenObj: minterToken,
        network,
        minter: minter.address,
      approver,
      approverAuthority,
        journal,
        governed: authorityByToken[entry.token].mode === "admin-registry",
      }, entry));
    }

    const initial = journal.state.initial;
    const final = await snapshotPlan(minterToken, plan, tokenAddresses);
    const assertions = assertFinalState(
      plan,
      initial,
      final,
      tokenAddresses,
      actorData.actors.MINTER,
      args.feeToken,
      transactions.map((transaction) => transaction.feePayment)
    );
    const completedBlock = await getLatestBlock(minterToken);
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      scriptVersion: SCRIPT_VERSION,
      completed: true,
      allPlannedMintsConfirmed: transactions.length === plan.length,
      allFinalAssertionsConfirmed: true,
      startedAtBlock: journal.state.startedAtBlock,
      completedAt: new Date().toISOString(),
      network: { ...network, block: completedBlock },
      initialFeePolicyEvidence,
      addresses: { ASSET: args.asset, FEE_TOKEN: args.feeToken },
      tokens: {
        asset: final.tokens[args.asset],
        feeToken: final.tokens[args.feeToken],
      },
      runs: args.runs,
      actors: actorData.actors,
      allowedActorOverlaps: actorData.overlaps,
      budgets: {
        unit: U,
        perRunUnderlying: UNDERLYING_PER_RUN,
        feeForTenRuns: FEE_FOR_TEN_RUNS,
        computedUnderlyingByRole: targets.underlyingByRole,
        computedFeeByRole: targets.feeByRole,
        computedFeeByAddress: targets.feeByAddress,
        configuredUnderlyingTotal: expectedUnderlying,
      },
      mintPlan: plan,
      initial,
      transactions,
      feePayments: assertions.feePayments,
      final,
      authorities,
      approverAuthority,
      runState: { path: journal.path },
      runStateConfigurationHash: journal.configurationHash,
      assertions: {
        configuredUnderlyingTotal: expectedUnderlying,
        expectedMintedByToken: assertions.expectedMintedByToken,
        everyNonMinterRecipientBalanceDeltaExact: true,
        minterFeeTokenFinalDeltaExact: true,
        everyFeePaymentDebitExact: true,
        everyTotalSupplyDeltaExact: true,
        everyMintEventExact: true,
        noUnexpectedUnderlyingRecipient: true,
      },
      hashes: {
        script: scriptHash,
        runtime: runtimeHash,
        feePolicyAllowlist: feePolicyHash,
        configuration: configHash,
        actorFile: actorData.hash,
      },
    };
    atomicWriteJson(args.outputPath, manifest);
    journal.state.completed = true;
    journal.state.outputHash = sha256(fs.readFileSync(args.outputPath));
    journal.save();
    console.log(
      `FUNDING_COMPLETE output=${args.outputPath} runState=${journal.path} ` +
      `operations=${plan.length} underlying=${expectedUnderlying} block=${completedBlock.number}`
    );
    return manifest;
  } catch (error) {
    if (error instanceof CheckpointStop) {
      journal.interrupt(error);
      console.error(
        `CHECKPOINT_STOP checkpoint=${error.checkpoint} runState=${journal.path} ` +
        `reason=${error.reason} txHash=${error.txHash}`
      );
    }
    throw error;
  } finally {
    journal.release();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FUNDING_FAILED reason=${JSON.stringify(error.message)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  FEE_FOR_TEN_RUNS,
  REQUIRED_ROLES,
  UNDERLYING_PER_RUN,
  assertDirectMintAuthority,
  assertMintAuthority,
  assertFinalState,
  authenticateMinter,
  buildMintPlan,
  buildTargets,
  ceilScaled,
  deriveFeePayment,
  loadActors,
  main,
  parseArgs,
  pollMintCompletion,
  FundingJournal,
  fundingRunStatePath,
  executeMint,
  readFeePolicyEvidence,
  validateActorDistinctness,
};
