const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { rest } = require("blockapps-rest");
const {
  config,
  fetchExpectedTestnetNetwork,
  optionalEnv,
  requiredEnv,
  rootNodeUrl,
} = require("./runtime");
const auth = require("../../auth");
const {
  assertMarkedOnlyOwner,
  positionalArguments,
  registeredCheckpoint,
} = require("./only-owner-registry");

const U = 10n ** 18n;
const RAY = 10n ** 27n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_RATE = 1000000021979553151239153027n;
const ZERO_ADDRESS = "0".repeat(40);
const ADDRESS_RE = /^[0-9a-f]{40}$/;
const POLL_LIMIT_MS = 60_000;
const POLL_INTERVAL_MS = Number(process.env.YIELD_VAULT_POLL_INTERVAL_MS || 2_000);
const ADMIN_REGISTRY = normalizeAddress(
  process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c"
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, jsonValue(child)])
    );
  }
  return value;
}

function stableJson(value, space = 0) {
  return JSON.stringify(jsonValue(value), null, space);
}

function parseJsonPreservingIntegers(value) {
  const source = String(value);
  let normalized = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (inString) {
      normalized += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      index++;
      continue;
    }
    if (character === "\"") {
      inString = true;
      normalized += character;
      index++;
      continue;
    }
    if (character === "-" || /\d/.test(character)) {
      let end = index + 1;
      while (end < source.length && /[0-9eE+.-]/.test(source[end])) end++;
      const token = source.slice(index, end);
      normalized += /^-?\d+$/.test(token) ? JSON.stringify(token) : token;
      index = end;
      continue;
    }
    normalized += character;
    index++;
  }
  return JSON.parse(normalized);
}

function cirrusResponseRows(data) {
  const parsed = typeof data === "string"
    ? parseJsonPreservingIntegers(data)
    : data;
  return Array.isArray(parsed) ? parsed : [];
}

function errorEvidence(error) {
  if (!error) return null;
  const evidence = {
    name: error.name || "Error",
    message: String(error.message || error),
    code: error.code == null ? null : error.code,
    stack: error.stack || null,
  };
  for (const key of ["status", "statusCode", "nonce", "accountSequence", "sequenceNumber"]) {
    if (error[key] != null) evidence[key] = error[key];
  }
  if (error.response) {
    evidence.response = {
      status: error.response.status == null ? null : error.response.status,
      statusText: error.response.statusText || null,
      data: error.response.data,
    };
  }
  return jsonValue(evidence);
}

function submissionNonce(value) {
  const visited = new Set();
  function visit(candidate, depth) {
    if (candidate == null || depth > 5) return null;
    if (typeof candidate !== "object") return null;
    if (visited.has(candidate)) return null;
    visited.add(candidate);
    for (const key of ["nonce", "accountSequence", "sequenceNumber", "account_sequence"]) {
      if (candidate[key] != null) return candidate[key];
    }
    for (const key of ["response", "data", "result", "txResult", "error", "details"]) {
      const found = visit(candidate[key], depth + 1);
      if (found != null) return found;
    }
    return null;
  }
  return visit(value, 0);
}

function hashValue(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value
    : stableJson(value);
  return crypto.createHash("sha256").update(input).digest("hex");
}

function hashFile(filePath) {
  return hashValue(fs.readFileSync(filePath));
}

function atomicWrite(filePath, value) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, `${stableJson(value, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, absolute);
    const directoryFd = fs.openSync(path.dirname(absolute), "r");
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } finally {
    if (fd != null) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function parseArgs(argv, required = []) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "help" || key === "deploy-old-proxy") {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index++;
  }
  if (parsed.help) return parsed;
  const missing = required.filter((key) => !parsed[key]);
  if (missing.length) {
    throw new Error(`Missing arguments: ${missing.map((key) => `--${key}`).join(", ")}`);
  }
  return parsed;
}

function env(name, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "defaultValue")) {
    return optionalEnv(name, options.defaultValue);
  }
  return requiredEnv(name);
}

function normalizeAddress(value, label = "address") {
  const normalized = String(value || "").trim().toLowerCase().replace(/^0x/, "");
  if (!ADDRESS_RE.test(normalized)) {
    throw new Error(`${label} must be a 40-character hexadecimal STRATO address`);
  }
  return normalized;
}

function bigint(value, label = "value") {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (Array.isArray(value) && value.length === 1) return bigint(value[0], label);
  if (value && typeof value === "object") {
    for (const key of ["value", "v", "contents", "result"]) {
      if (value[key] != null) return bigint(value[key], label);
    }
  }
  const text = String(value == null ? "0" : value).trim();
  if (/^-?\d+$/.test(text)) return BigInt(text);
  if (/^0x[0-9a-f]+$/i.test(text)) return BigInt(text);
  throw new Error(`Cannot parse ${label} as an integer: ${stableJson(value)}`);
}

function boolean(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") return true;
  if (value === 0 || value === "0" || String(value).toLowerCase() === "false" || value == null) {
    return false;
  }
  throw new Error(`Cannot parse boolean: ${stableJson(value)}`);
}

function field(state, names, defaultValue) {
  for (const name of names) {
    if (state && state[name] != null) return state[name];
  }
  return defaultValue;
}

function numericField(state, names, defaultValue = 0) {
  for (const name of names) {
    if (!state || state[name] == null) continue;
    try {
      bigint(state[name], name);
      return state[name];
    } catch (_) {
      // getState also includes function signatures under public method names.
    }
  }
  return defaultValue;
}

function booleanField(state, names, defaultValue = false) {
  for (const name of names) {
    if (!state || state[name] == null) continue;
    const value = state[name];
    if (typeof value === "boolean" || value === 0 || value === 1 ||
        ["0", "1", "true", "false"].includes(String(value).toLowerCase())) {
      return boolean(value);
    }
  }
  return defaultValue;
}

function addressField(state, names, defaultValue) {
  for (const name of names) {
    if (!state || typeof state[name] !== "string") continue;
    const candidate = state[name].trim().toLowerCase().replace(/^0x/, "");
    if (ADDRESS_RE.test(candidate)) return candidate;
  }
  return defaultValue;
}

function normalizedKey(key) {
  return String(key).toLowerCase().replace(/^0x/, "").replace(/^"|"$/g, "");
}

function mappingValue(mapping, keys, defaultValue = "0") {
  let current = mapping;
  for (const wanted of keys) {
    if (current == null) return defaultValue;
    if (Array.isArray(current)) {
      const row = current.find((item) => {
        const candidate = item && field(item, ["key", "key1", "address", "owner", "id"]);
        return candidate != null && normalizedKey(candidate) === normalizedKey(wanted);
      });
      current = row && field(row, ["value", "value1", "request", "data"]);
      continue;
    }
    if (typeof current !== "object") return defaultValue;
    const actualKey = Object.keys(current).find(
      (key) => normalizedKey(key) === normalizedKey(wanted)
    );
    if (actualKey == null) return defaultValue;
    current = current[actualKey];
  }
  return current == null ? defaultValue : current;
}

function requestValue(requests, requestId) {
  const raw = mappingValue(requests, [String(requestId)], null);
  if (!raw) return { shares: "0", receiver: ZERO_ADDRESS, next: "0", exists: false };
  if (Array.isArray(raw)) {
    return {
      shares: bigint(raw[0] || 0).toString(),
      receiver: raw[1] ? normalizeAddress(raw[1], `request ${requestId} receiver`) : ZERO_ADDRESS,
      next: bigint(raw[2] || 0).toString(),
      exists: boolean(raw[3]),
    };
  }
  return {
    shares: bigint(field(raw, ["shares"], 0)).toString(),
    receiver: normalizeAddress(field(raw, ["receiver"], ZERO_ADDRESS), `request ${requestId} receiver`),
    next: bigint(field(raw, ["next"], 0)).toString(),
    exists: boolean(field(raw, ["exists"], false)),
  };
}

async function authenticateActors(actorNames) {
  const actors = {};
  for (const actor of actorNames) {
    const username = env(`${actor}_USERNAME`);
    const password = env(`${actor}_PASSWORD`);
    const address = normalizeAddress(env(`${actor}_ADDRESS`), `${actor}_ADDRESS`);
    const token = await auth.getUserToken(username, password);
    if (!token) throw new Error(`Authentication returned no token for ${actor}`);
    const authenticatedAddress = normalizeAddress(
      await rest.getKey({ token }, { config }),
      `${actor} authenticated key`
    );
    if (authenticatedAddress !== address) {
      throw new Error(
        `${actor}_ADDRESS ${address} does not match authenticated key ${authenticatedAddress}`
      );
    }
    actors[actor] = { username, address, token: { token } };
  }
  return actors;
}

async function readAdminMembership(tokenObj, signer, registryAddress = ADMIN_REGISTRY) {
  const registry = await rest.getState(
    tokenObj,
    { address: normalizeAddress(registryAddress), name: "AdminRegistry" },
    { config }
  );
  return bigint(
    mappingValue(field(registry, ["adminMap"], {}), [normalizeAddress(signer)], "0"),
    "AdminRegistry.adminMap membership"
  );
}

async function validateStorageOwnerAuthority(
  actor,
  storageOwner,
  dependencies = {}
) {
  const owner = normalizeAddress(storageOwner, "storage owner");
  const signer = normalizeAddress(actor.address, "authenticated signer");
  if (owner === signer) {
    return {
      mode: "direct-owner",
      signer,
      storageOwner: owner,
      adminRegistry: null,
      adminMapMembership: null,
      verified: true,
    };
  }
  if (owner !== ADMIN_REGISTRY) {
    throw new Error(
      `Storage owner ${owner} differs from authenticated signer ${signer} and AdminRegistry ${ADMIN_REGISTRY}`
    );
  }
  const read = dependencies.readAdminMembership || readAdminMembership;
  const membership = bigint(
    await read(actor.token, signer, owner),
    "AdminRegistry.adminMap membership"
  );
  if (membership <= 0n) {
    throw new Error(`Authenticated signer ${signer} is not a live AdminRegistry admin`);
  }
  return {
    mode: "admin-registry",
    signer,
    storageOwner: owner,
    adminRegistry: owner,
    adminMapMembership: membership.toString(),
    verified: true,
  };
}

function assertDistinctAddresses(addresses) {
  const entries = Object.entries(addresses).filter(([, value]) => value);
  const seen = new Map();
  for (const [name, raw] of entries) {
    const address = normalizeAddress(raw, name);
    if (seen.has(address)) {
      throw new Error(`${name} and ${seen.get(address)} must not share address ${address}`);
    }
    seen.set(address, name);
  }
}

async function getContractState(tokenObj, address, name) {
  return rest.getState(
    tokenObj,
    { address: normalizeAddress(address), name },
    { config }
  );
}

async function readTokenBalances(tokenObj, tokenAddress, addresses, contractName = "Token") {
  const tokenState = await getContractState(tokenObj, tokenAddress, contractName);
  const balances = field(tokenState, ["_balances", "balances"], {});
  return Object.fromEntries(
    Object.entries(addresses).map(([name, address]) => [
      name,
      bigint(mappingValue(balances, [normalizeAddress(address, name)])).toString(),
    ])
  );
}

async function latestBlock(tokenObj) {
  const baseUrl = rootNodeUrl();
  const response = await axios.get(`${baseUrl}/strato-api/eth/v1.2/block/last/1`, {
    headers: { Authorization: `Bearer ${tokenObj.token}` },
  });
  const row = Array.isArray(response.data) ? response.data[0] : response.data;
  if (!row) throw new Error("Latest block endpoint returned no block");
  const blockData = row.blockData && typeof row.blockData === "object" ? row.blockData : {};
  const timestampRaw = field(
    row,
    ["timestamp", "blockTimestamp", "block_timestamp"],
    field(blockData, ["timestamp", "blockTimestamp", "block_timestamp"])
  );
  const timestamp = typeof timestampRaw === "number"
    ? timestampRaw
    : /^\d+$/.test(String(timestampRaw || ""))
      ? Number(timestampRaw)
      : Math.floor(new Date(timestampRaw).getTime() / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error(`Could not parse latest block timestamp: ${stableJson(row)}`);
  }
  return {
    number: String(field(
      row,
      ["number", "blockNumber", "block_number"],
      field(blockData, ["number", "blockNumber", "block_number"], "")
    )),
    timestamp,
    raw: row,
  };
}

async function readVaultSnapshot(context) {
  const { actors, addresses, requestIds = [1, 2, 3, 4] } = context;
  const reader = actors.OWNER || Object.values(actors)[0];
  const [vaultState, assetState, proxyState] = await Promise.all([
    getContractState(reader.token, addresses.VAULT_PROXY, "YieldVault"),
    getContractState(reader.token, addresses.ASSET, context.assetContractName || "Token"),
    getContractState(reader.token, addresses.VAULT_PROXY, "Proxy"),
  ]);

  const actorAddresses = Object.fromEntries(
    Object.entries(addresses).filter(([name]) =>
      ["OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK",
       "REWARD_DISTRIBUTOR", "DAVE", "DONOR", "SMOKE_USER", "VAULT_PROXY"].includes(name)
    )
  );
  const shareMap = field(vaultState, ["_balances", "balances"], {});
  const tokenMap = field(assetState, ["_balances", "balances"], {});
  const allowanceMap = field(assetState, ["_allowances", "allowances"], {});
  const strategyDebtMap = field(vaultState, ["strategyDebt"], {});
  const approvalsMap = field(vaultState, ["approvedStrategies"], {});
  const activeRequestMap = field(vaultState, ["activeRequestId"], {});
  const claimsMap = field(vaultState, ["claimableAssets"], {});
  const requestsMap = field(vaultState, ["requests"], {});
  const requestOwnerMap = field(vaultState, ["requestOwner"], {});

  const shares = {};
  const underlying = {};
  const allowances = {};
  const strategyDebt = {};
  const approvedStrategies = {};
  const activeRequestId = {};
  const claimableAssets = {};
  for (const [name, address] of Object.entries(actorAddresses)) {
    shares[name] = bigint(mappingValue(shareMap, [address])).toString();
    underlying[name] = bigint(mappingValue(tokenMap, [address])).toString();
    allowances[name] = bigint(mappingValue(allowanceMap, [address, addresses.VAULT_PROXY])).toString();
    strategyDebt[name] = bigint(mappingValue(strategyDebtMap, [address])).toString();
    approvedStrategies[name] = boolean(mappingValue(approvalsMap, [address], false));
    activeRequestId[name] = bigint(mappingValue(activeRequestMap, [address])).toString();
    claimableAssets[name] = bigint(mappingValue(claimsMap, [address])).toString();
  }

  const deployedAssets = bigint(numericField(vaultState, ["deployedAssets"], 0));
  const idle = bigint(underlying.VAULT_PROXY || 0);
  const totalClaimableAssets = bigint(numericField(vaultState, ["totalClaimableAssets"], 0));
  const totalSupply = bigint(numericField(vaultState, ["_totalSupply"], 0));
  const paused = booleanField(vaultState, ["_paused"], false);
  const accrualInitialized = booleanField(vaultState, ["accrualInitialized"], false);
  const accountedAssets = bigint(numericField(vaultState, ["accountedAssets"], 0));
  const totalAssets = idle + deployedAssets;
  const activeAssets = totalAssets > totalClaimableAssets ? totalAssets - totalClaimableAssets : 0n;
  const exchangeRate = totalSupply === 0n ? U : activeAssets * U / totalSupply;
  const queueHead = bigint(numericField(vaultState, ["queueHead"], 0));
  const minIdleBps = bigint(numericField(vaultState, ["minIdleBps"], 0));
  const freeIdleForQueueProcessing = idle > totalClaimableAssets
    ? idle - totalClaimableAssets
    : 0n;
  const reconciledAssets = accrualInitialized && totalAssets > accountedAssets
    ? accountedAssets
    : totalAssets;
  const reconciledActiveAssets = reconciledAssets > totalClaimableAssets
    ? reconciledAssets - totalClaimableAssets
    : 0n;
  const freeIdleForInstantWithdrawals = queueHead === 0n &&
    reconciledActiveAssets > deployedAssets
    ? reconciledActiveAssets - deployedAssets
    : 0n;
  const minimumIdle = minIdleBps === 0n
    ? 0n
    : (activeAssets * minIdleBps + 9_999n) / 10_000n;
  const derivedMaxDeploy = !paused && queueHead === 0n && freeIdleForQueueProcessing > minimumIdle
    ? freeIdleForQueueProcessing - minimumIdle
    : 0n;

  return jsonValue({
    implementation: normalizeAddress(
      addressField(proxyState, ["logicContract"], ZERO_ADDRESS),
      "Proxy.logicContract"
    ),
    owner: normalizeAddress(
      addressField(vaultState, ["_owner"], addressField(proxyState, ["_owner"], ZERO_ADDRESS)),
      "vault owner"
    ),
    proxyOwner: normalizeAddress(
      addressField(proxyState, ["_owner", "owner"], ZERO_ADDRESS),
      "proxy owner"
    ),
    asset: normalizeAddress(addressField(vaultState, ["_asset"], ZERO_ADDRESS), "vault asset"),
    name: field(vaultState, ["_name", "name"], ""),
    symbol: field(vaultState, ["_symbol", "symbol"], ""),
    decimals: bigint(numericField(assetState, ["customDecimals", "_decimals"], 18)).toString(),
    paused,
    vaultInitialized: booleanField(vaultState, ["vaultInitialized"], false),
    accrualInitialized,
    perSecondSavingsRate: bigint(numericField(vaultState, ["perSecondSavingsRate"], 0)).toString(),
    lastAccrual: bigint(numericField(vaultState, ["lastAccrual"], 0)).toString(),
    rewardDistributor: normalizeAddress(
      addressField(vaultState, ["rewardDistributor"], ZERO_ADDRESS),
      "rewardDistributor"
    ),
    accountedAssets: accountedAssets.toString(),
    idle: idle.toString(),
    deployedAssets: deployedAssets.toString(),
    totalAssets: totalAssets.toString(),
    activeAssets: activeAssets.toString(),
    totalSupply: totalSupply.toString(),
    exchangeRate: exchangeRate.toString(),
    freeIdleForInstantWithdrawals: freeIdleForInstantWithdrawals.toString(),
    freeIdleForQueueProcessing: freeIdleForQueueProcessing.toString(),
    maxDeploy: derivedMaxDeploy.toString(),
    minIdleBps: minIdleBps.toString(),
    nextRequestId: bigint(numericField(vaultState, ["nextRequestId"], 0)).toString(),
    queueHead: queueHead.toString(),
    queueTail: bigint(numericField(vaultState, ["queueTail"], 0)).toString(),
    totalQueuedShares: bigint(numericField(vaultState, ["totalQueuedShares"], 0)).toString(),
    totalClaimableAssets: totalClaimableAssets.toString(),
    shares,
    underlying,
    allowances,
    strategyDebt,
    approvedStrategies,
    activeRequestId,
    claimableAssets,
    requests: Object.fromEntries(requestIds.map((id) => [String(id), requestValue(requestsMap, id)])),
    requestOwner: Object.fromEntries(
      requestIds.map((id) => [
        String(id),
        normalizeAddress(mappingValue(requestOwnerMap, [String(id)], ZERO_ADDRESS), `requestOwner ${id}`),
      ])
    ),
  });
}

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value == null ? undefined : value[key], object);
}

function assertEqual(actual, expected, label) {
  const left = typeof actual === "bigint" ? actual.toString() : actual;
  const right = typeof expected === "bigint" ? expected.toString() : expected;
  if (stableJson(left) !== stableJson(right)) {
    throw new Error(`${label}: expected ${stableJson(right)}, observed ${stableJson(left)}`);
  }
}

function assertSnapshot(snapshot, expected, prefix = "state") {
  const failures = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const observed = getPath(snapshot, key);
    if (stableJson(observed) !== stableJson(jsonValue(expectedValue))) {
      failures.push(`${key}: expected ${stableJson(expectedValue)}, observed ${stableJson(observed)}`);
    }
  }
  if (failures.length) throw new Error(`${prefix} mismatch:\n${failures.join("\n")}`);
}

function eventAttributes(event) {
  let attributes = event && event.attributes;
  if (typeof attributes === "string") {
    try {
      attributes = JSON.parse(attributes);
    } catch (_) {
      attributes = {};
    }
  }
  return { ...(event || {}), ...(attributes || {}) };
}

function eventBelongsTo(event, address) {
  const eventAddress = event.address || event._queriedAddress;
  if (!eventAddress) return false;
  try {
    return normalizeAddress(eventAddress) === normalizeAddress(address);
  } catch (_) {
    return false;
  }
}

function assertEventValues(events, eventName, expected) {
  const event = events.find((candidate) => candidate.eventName === eventName);
  if (!event) throw new Error(`Missing ${eventName} event`);
  const attributes = eventAttributes(event);
  const failures = [];
  for (const [name, expectedValue] of Object.entries(expected)) {
    const observed = attributes[name];
    if (typeof expectedValue === "boolean") {
      try {
        if (boolean(observed) !== expectedValue) {
          failures.push(`${name}: expected ${expectedValue}, observed ${stableJson(observed)}`);
        }
      } catch (_) {
        failures.push(`${name}: expected ${expectedValue}, observed ${stableJson(observed)}`);
      }
    } else if (typeof expectedValue === "bigint" || /^\d+$/.test(String(expectedValue))) {
      try {
        if (bigint(observed, `${eventName}.${name}`) !== bigint(expectedValue)) {
          failures.push(`${name}: expected ${expectedValue}, observed ${stableJson(observed)}`);
        }
      } catch (_) {
        failures.push(`${name}: expected ${expectedValue}, observed ${stableJson(observed)}`);
      }
    } else if (stableJson(observed) !== stableJson(expectedValue)) {
      failures.push(`${name}: expected ${stableJson(expectedValue)}, observed ${stableJson(observed)}`);
    }
  }
  if (failures.length) throw new Error(`${eventName} event mismatch:\n${failures.join("\n")}`);
  return attributes;
}

function snapshotDiff(expected, actual, prefix = "") {
  const diffs = [];
  const keys = new Set([
    ...Object.keys(expected || {}),
    ...Object.keys(actual || {}),
  ]);
  for (const key of [...keys].sort()) {
    // Read-view block bounds and pending accrual are time-dependent evidence,
    // not durable contract state. Their equations are journaled separately.
    if (!prefix && key === "liveViews") continue;
    const dotted = prefix ? `${prefix}.${key}` : key;
    const left = expected && expected[key];
    const right = actual && actual[key];
    if (left && right && typeof left === "object" && typeof right === "object" &&
        !Array.isArray(left) && !Array.isArray(right)) {
      diffs.push(...snapshotDiff(left, right, dotted));
    } else if (stableJson(left) !== stableJson(right)) {
      diffs.push({ field: dotted, expected: left, observed: right });
    }
  }
  return diffs;
}

function snapshotSubsetDiff(expected, actual, prefix = "") {
  const diffs = [];
  for (const key of Object.keys(expected || {}).sort()) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    const left = expected[key];
    const right = actual && actual[key];
    if (left && typeof left === "object" && !Array.isArray(left)) {
      if (!right || typeof right !== "object" || Array.isArray(right)) {
        diffs.push({ field: dotted, expected: left, observed: right });
      } else {
        diffs.push(...snapshotSubsetDiff(left, right, dotted));
      }
    } else if (stableJson(left) !== stableJson(right)) {
      diffs.push({ field: dotted, expected: left, observed: right });
    }
  }
  return diffs;
}

function trace(checkpoint, point, state, fields = []) {
  const selected = Object.fromEntries(fields.map((key) => [key, getPath(state, key)]));
  console.log(`TRACE checkpoint=${checkpoint} point=${point} state=${stableJson(selected)}`);
}

function receiptHash(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => item && (
    item.hash || item.transactionHash || item.transaction_hash ||
    item.txHash || item.txResult && item.txResult.transactionHash
  )).find(Boolean) || null;
}

function receiptIssueId(receipt) {
  const candidates = [
    receipt && receipt.issueId,
    receipt && receipt.txResult && receipt.txResult.response && receipt.txResult.response.v,
    receipt && receipt.data && receipt.data.contents,
  ];
  return candidates.flat().find((value) => typeof value === "string" && value) || null;
}

function receiptBlock(receipt) {
  return {
    number: String(field(receipt, ["blockNumber", "block_number"], "")),
    timestamp: field(receipt, ["blockTimestamp", "block_timestamp", "timestamp"], null),
  };
}

function confirmedBlock(receipt, events = []) {
  const block = receiptBlock(receipt);
  if (!block.number && events[0]) {
    block.number = String(field(events[0], ["block_number", "blockNumber"], ""));
  }
  if (!block.timestamp && events[0]) {
    block.timestamp = field(events[0], ["block_timestamp", "blockTimestamp"], null);
  }
  return block;
}

function isPendingReceipt(receipt) {
  return !receipt || !receipt.status || receipt.status === "Pending";
}

function isFailedReceipt(receipt) {
  return !isPendingReceipt(receipt) && receipt.status !== "Success";
}

async function pollReceipt(tokenObj, hash, deadline, onStatus) {
  let latest = null;
  while (Date.now() < deadline) {
    const results = await rest.getBlocResults(tokenObj, [hash], { config, isAsync: true });
    latest = Array.isArray(results) ? results[0] : results;
    if (onStatus) await onStatus(latest);
    if (latest && latest.status && latest.status !== "Pending") return latest;
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  return latest;
}

async function fetchEvents(tokenObj, contractName, eventNames, txHash, address) {
  const baseUrl = rootNodeUrl();
  const events = [];
  try {
    const response = await axios.get(`${baseUrl}/cirrus/search/event`, {
      headers: { Authorization: `Bearer ${tokenObj.token}` },
      params: { transaction_hash: `eq.${txHash}`, order: "block_timestamp.asc,id.asc" },
      transformResponse: [(data) => data],
    });
    for (const row of cirrusResponseRows(response.data)) {
      events.push({ ...row, eventName: row.event_name || row.eventName });
    }
  } catch (error) {
    if (!error.response || error.response.status !== 404) throw error;
  }
  for (const eventName of eventNames || []) {
    const table = `BlockApps-${contractName}-${eventName}`;
    try {
      const response = await axios.get(`${baseUrl}/cirrus/search/${table}`, {
        headers: { Authorization: `Bearer ${tokenObj.token}` },
        params: {
          address: `eq.${normalizeAddress(address)}`,
          transaction_hash: `eq.${txHash}`,
          order: "block_timestamp.asc",
        },
        transformResponse: [(data) => data],
      });
      for (const row of cirrusResponseRows(response.data)) {
        events.push({ ...row, eventName, _queriedAddress: address });
      }
    } catch (error) {
      if (!error.response || error.response.status !== 404) throw error;
    }
  }
  const unique = new Map();
  for (const event of events) unique.set(eventIdentityKey(event, txHash), event);
  return [...unique.values()];
}

function eventIdentityKey(event, fallbackTransactionHash = "") {
  if (event && event.id != null) return `id:${event.id}`;
  return [
    field(event, ["transaction_hash", "transactionHash"], fallbackTransactionHash),
    field(event, ["event_index", "eventIndex"], ""),
    event && (event.eventName || event.event_name) || "",
    event && event.address || "",
  ].join("|");
}

function mergeEvents(...groups) {
  const unique = new Map();
  for (const event of groups.flat()) unique.set(eventIdentityKey(event), event);
  return [...unique.values()];
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

function canonicalGovernanceArg(value) {
  if (Array.isArray(value)) {
    return `array:${stableJson(value.map(canonicalGovernanceArg))}`;
  }
  if (value && typeof value === "object") {
    return `object:${stableJson(jsonValue(value))}`;
  }
  let normalized = value;
  if (typeof normalized === "string" &&
      ((normalized.startsWith("\"") && normalized.endsWith("\"")) ||
       (normalized.startsWith("'") && normalized.endsWith("'")))) {
    try {
      normalized = normalized.startsWith("\"")
        ? JSON.parse(normalized)
        : normalized.slice(1, -1);
    } catch (_) {
      return `invalid:${normalized}`;
    }
  }
  if (typeof normalized === "string" &&
      ["true", "false"].includes(normalized.toLowerCase())) {
    return `bool:${normalized.toLowerCase()}`;
  }
  if (typeof normalized === "boolean") return `bool:${normalized}`;
  try {
    return `address:${normalizeAddress(normalized)}`;
  } catch (_) {
    return /^\d+$/.test(String(normalized))
      ? `integer:${BigInt(normalized)}`
      : `text:${String(normalized)}`;
  }
}

function governanceEventMatches(row, expected) {
  const attrs = eventAttributes(row);
  const args = governanceArgs(row);
  if (!args) return false;
  let target;
  try {
    target = normalizeAddress(attrs.target, "governance event target");
  } catch (_) {
    return false;
  }
  return target === expected.target &&
    String(attrs.func) === expected.func &&
    args.length === expected.args.length &&
    args.every((value, index) =>
      canonicalGovernanceArg(value) === canonicalGovernanceArg(expected.args[index]));
}

function governanceEventPosition(row, label) {
  const block = bigint(field(row, ["block_number", "blockNumber"], null), `${label} block`);
  const rawTimestamp = field(row, ["block_timestamp", "blockTimestamp"], null);
  const timestamp = /^\d+$/.test(String(rawTimestamp || ""))
    ? Number(rawTimestamp) * (String(rawTimestamp).length <= 10 ? 1000 : 1)
    : Date.parse(rawTimestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error(`${label} timestamp is invalid`);
  }
  const rawIndex = field(row, ["event_index", "eventIndex", "id"], null);
  return {
    block,
    timestamp,
    eventIndex: rawIndex == null || !/^\d+$/.test(String(rawIndex))
      ? null
      : bigint(rawIndex, `${label} event index`),
    transactionHash: receiptHash(row),
  };
}

function governanceEventIsAfter(createdRow, executedRow) {
  const created = governanceEventPosition(createdRow, "IssueCreated");
  const executed = governanceEventPosition(executedRow, "IssueExecuted");
  if (executed.block !== created.block) return executed.block > created.block;
  if (executed.timestamp !== created.timestamp) return executed.timestamp > created.timestamp;
  return created.eventIndex != null && executed.eventIndex != null &&
    executed.eventIndex > created.eventIndex;
}

async function governanceRows(tokenObj, table, params) {
  try {
    const response = await axios.get(
      `${rootNodeUrl()}/cirrus/search/BlockApps-AdminRegistry-${table}`,
      {
        headers: { Authorization: `Bearer ${tokenObj.token}` },
        params,
      }
    );
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    if (error.response && error.response.status === 404) return [];
    throw error;
  }
}

async function findIssueExecution(tokenObj, issueId, createdRow, expected) {
  if (!issueId || !createdRow || !expected) return null;
  const rows = await governanceRows(tokenObj, "IssueExecuted", {
    address: `eq.${ADMIN_REGISTRY}`,
    issueId: `eq.${issueId}`,
    order: "block_number.asc,event_index.asc,id.asc",
    limit: "100",
  });
  const matching = rows.filter((row) =>
    governanceEventMatches(row, expected) && governanceEventIsAfter(createdRow, row));
  if (matching.length > 1) {
    throw new Error(`Governance issue ${issueId} has multiple matching newer IssueExecuted rows`);
  }
  const row = matching[0];
  const transactionHash = row && receiptHash(row);
  return transactionHash ? { transactionHash, row } : null;
}

async function findIssueCreated(tokenObj, transactionHash, expected) {
  if (!transactionHash || !expected) return null;
  const rows = await governanceRows(tokenObj, "IssueCreated", {
    address: `eq.${ADMIN_REGISTRY}`,
    transaction_hash: `eq.${transactionHash}`,
    order: "block_number.asc,event_index.asc,id.asc",
    limit: "100",
  });
  const matching = rows.filter((row) => governanceEventMatches(row, expected));
  if (matching.length > 1) {
    throw new Error(`Submission ${transactionHash} created multiple matching governance issues`);
  }
  const row = matching[0];
  const issueId = row && field(eventAttributes(row), ["issueId", "issue_id"], null);
  return issueId == null ? null : {
    issueId: String(issueId),
    row,
    position: governanceEventPosition(row, "IssueCreated"),
  };
}

function logGovernanceIssue(checkpoint, transactionHash, created, expected) {
  console.log(
    `GOVERNANCE_ISSUE checkpoint=${checkpoint} submissionHash=${transactionHash} ` +
    `issueId=${created.issueId} target=${expected.target} func=${expected.func} ` +
    `args=${stableJson(jsonValue(expected.args))} creationBlock=${created.position.block} ` +
    `creationTimestamp=${created.position.timestamp}`
  );
}

function rawTransactionArgs(row) {
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

function rawLogicalPayload(row) {
  const args = rawTransactionArgs(row);
  if (!args) return null;
  const contractName = field(row, ["cName", "contractName"], null);
  const method = field(row, ["funcName", "functionName", "method"], null);
  if (contractName === "User" && method === "callContract" && args.length >= 2) {
    return {
      target: normalizeAddress(args[0], "raw User.callContract target"),
      func: String(args[1]).replace(/^['"]|['"]$/g, ""),
      args: args.slice(2),
    };
  }
  const target = field(row, ["to", "contractAddress"], null);
  if (target == null || method == null) return null;
  return {
    target: normalizeAddress(target, "raw transaction target"),
    func: String(method),
    args: contractName === "User" && method === "createContract" &&
      args.length > 3
      ? [args[0], args[1], args.slice(2)]
      : args,
  };
}

function rawPayloadMatches(row, expected) {
  let logical;
  try {
    logical = rawLogicalPayload(row);
  } catch (_) {
    return false;
  }
  return Boolean(logical) &&
    logical.target === expected.target &&
    logical.func === expected.func &&
    logical.func !== "castVoteOnIssue" &&
    logical.args.length === expected.args.length &&
    logical.args.every((value, index) =>
      canonicalGovernanceArg(value) === canonicalGovernanceArg(expected.args[index]));
}

async function readRawTransaction(tokenObj, hash) {
  const response = await axios.get(`${rootNodeUrl()}/strato-api/eth/v1.2/transaction`, {
    headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
    params: { hash, limit: "2" },
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  if (rows.length !== 1 || !sameTransactionHash(transactionHash(rows[0]), hash)) {
    throw new Error(`Raw approval transaction ${hash} returned ${rows.length} exact rows`);
  }
  return rows[0];
}

function governanceApprovalCall(expected) {
  if (expected.func === "castVoteOnIssue") {
    throw new Error("AdminRegistry.castVoteOnIssue is forbidden");
  }
  if (expected.func === "createContract") {
    if (expected.args.length !== 3 || !Array.isArray(expected.args[2])) {
      throw new Error("User.createContract governance payload must contain nested constructor args");
    }
    return {
      contract: { address: expected.target, name: "User" },
      method: "createContract",
      args: {
        contractName: expected.args[0],
        contractSrc: expected.args[1],
        args: expected.args[2].map((argument) =>
          typeof argument === "string" ? JSON.stringify(argument) : argument),
      },
      txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
    };
  }
  return null;
}

function assertGovernanceApprover(context, primaryActor, expected) {
  const approver = context.actors && context.actors.APPROVER;
  if (!approver || !approver.token) {
    throw new Error("Governed operation requires independently authenticated APPROVER");
  }
  if (normalizeAddress(approver.address, "APPROVER address") ===
      normalizeAddress(primaryActor.address, "primary signer address")) {
    throw new Error("APPROVER must differ from the primary signer for every governed operation");
  }
  const authority = context.approverAuthority;
  if (!authority || authority.verified !== true ||
      bigint(authority.adminMapMembership, "APPROVER AdminRegistry membership") <= 0n ||
      normalizeAddress(authority.signer, "APPROVER authority signer") !== approver.address ||
      normalizeAddress(authority.adminRegistry, "APPROVER authority registry") !== ADMIN_REGISTRY) {
    throw new Error("APPROVER is not a verified live AdminRegistry admin");
  }
  if (!expected || expected.func === "castVoteOnIssue") {
    throw new Error("Governance approval requires an exact non-castVoteOnIssue payload");
  }
  return approver;
}

async function recoverGovernanceApproval(context, checkpoint, expected, approver) {
  const entry = context.journal.state.checkpoints[checkpoint];
  const approval = entry.governanceApproval;
  const nonce = approval.submittedNonce == null
    ? approval.preSubmissionSequence
    : String(approval.submittedNonce);
  if (nonce == null) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      null,
      "Hashless governance approval has no recoverable APPROVER account sequence",
      approval
    );
  }
  const lookup = await lookupRawSubmission(approver.token, approver.address, nonce);
  const rows = [...lookup.rows || [], ...lookup.queuedRows || []];
  const exact = rows.filter((row) =>
    transactionSender(row) === approver.address && rawPayloadMatches(row, expected));
  const hashes = [...new Set(exact.map(transactionHash).filter(Boolean))];
  if (rows.length && (hashes.length !== 1 || exact.length !== rows.length)) {
    throw new Error("Hashless APPROVER nonce resolved to a wrong or ambiguous governance payload");
  }
  if (hashes.length === 1) {
    return {
      transactionHash: hashes[0],
      recoveredByApproverNonce: true,
      recoveryLookup: lookup,
    };
  }
  const account = await readAccountSubmissionState(approver.token, approver.address);
  const absent = lookup.lookupPerformed === true &&
    lookup.queuedLookupPerformed === true &&
    String(account.sequence) === String(nonce);
  if (!absent) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      null,
      "Hashless governance approval could not be recovered by APPROVER nonce",
      { nonce, account, lookup }
    );
  }
  return {
    definitivelyAbsent: true,
    recoveryLookup: lookup,
    account,
  };
}

async function approveGovernedSubmission(
  context,
  checkpoint,
  spec,
  primaryActor,
  expected,
  deadline
) {
  const approver = assertGovernanceApprover(context, primaryActor, expected);
  const journal = context.journal;
  let entry = journal.state.checkpoints[checkpoint];
  let approval = entry.governanceApproval || null;
  const directCall = governanceApprovalCall(expected);
  const approvalArgs = typeof spec.approvalArgs === "function"
    ? spec.approvalArgs(entry, context)
    : spec.approvalArgs || entry.arguments;
  if (!directCall && (!approvalArgs || typeof approvalArgs !== "object")) {
    throw new Error(`${checkpoint} has no exact arguments for the APPROVER call`);
  }
  const callArgs = directCall || {
    contract: {
      address: expected.target,
      name: spec.contractName,
    },
    method: spec.method,
    args: approvalArgs,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  if (callArgs.method !== expected.func ||
      normalizeAddress(callArgs.contract.address) !== expected.target) {
    throw new Error(`${checkpoint} APPROVER call target/function differs from governance payload`);
  }

  if (!approval) {
    journal.updateSubmitted(checkpoint, {
      governanceApproval: {
        status: "ready",
        intentPersistedAt: new Date().toISOString(),
        approver: {
          role: "APPROVER",
          username: approver.username,
          address: approver.address,
        },
        target: expected.target,
        func: expected.func,
        args: expected.args,
        call: callArgs,
      },
    });
    await injectFault(context, "after_approval_ready", { checkpoint, expected });
    entry = journal.state.checkpoints[checkpoint];
    approval = entry.governanceApproval;
  } else {
    const recordedPayload = {
      target: approval.target,
      func: approval.func,
      args: approval.args,
    };
    if (stableJson(recordedPayload) !== stableJson(expected) ||
        normalizeAddress(approval.approver.address) !== approver.address) {
      throw new Error(`${checkpoint} saved governance approval intent changed`);
    }
  }

  let approvalHash = approval.transactionHash || null;
  if (!approvalHash && approval.status === "dispatching") {
    const recovered = await recoverGovernanceApproval(
      context,
      checkpoint,
      expected,
      approver
    );
    if (recovered.transactionHash) {
      journal.updateSubmitted(checkpoint, {
        governanceApproval: {
          ...approval,
          ...recovered,
          status: "submitted",
        },
      });
      approval = journal.state.checkpoints[checkpoint].governanceApproval;
      approvalHash = recovered.transactionHash;
    } else {
      journal.updateSubmitted(checkpoint, {
        governanceApproval: {
          ...approval,
          status: "ready",
          definitiveAbsenceEvidence: recovered,
        },
      });
      approval = journal.state.checkpoints[checkpoint].governanceApproval;
    }
  }

  if (!approvalHash && approval.status === "ready") {
    const account = await readAccountSubmissionState(approver.token, approver.address);
    journal.updateSubmitted(checkpoint, {
      governanceApproval: {
        ...approval,
        status: "dispatching",
        dispatchingAt: new Date().toISOString(),
        preSubmissionSequence: account.sequence,
        preSubmissionAccountEvidence: account,
      },
    });
    await injectFault(context, "after_approval_dispatching", { checkpoint, expected });
    approval = journal.state.checkpoints[checkpoint].governanceApproval;
    let response;
    try {
      response = await rest.call(approver.token, callArgs, {
        config,
        cacheNonce: false,
        isAsync: true,
      });
    } catch (error) {
      journal.updateSubmitted(checkpoint, {
        governanceApproval: {
          ...approval,
          status: "dispatching",
          submittedNonce: submissionNonce(error),
          submissionError: errorEvidence(error),
        },
      });
      throw new CheckpointStop(
        checkpoint,
        "unknown_status",
        null,
        "APPROVER dispatch returned no durable hash; recover by nonce before retry",
        errorEvidence(error)
      );
    }
    approvalHash = receiptHash(response);
    if (!approvalHash) {
      journal.updateSubmitted(checkpoint, {
        governanceApproval: {
          ...approval,
          status: "dispatching",
          submittedNonce: submissionNonce(response),
          rawSubmission: response,
        },
      });
      throw new CheckpointStop(
        checkpoint,
        "unknown_status",
        null,
        "APPROVER submission returned no durable hash; recover by nonce before retry",
        response
      );
    }
    journal.updateSubmitted(checkpoint, {
      governanceApproval: {
        ...approval,
        status: "submitted",
        transactionHash: approvalHash,
        submittedNonce: submissionNonce(response),
        rawSubmission: response,
        submittedAt: new Date().toISOString(),
      },
    });
    await injectFault(context, "after_approval_submitted", {
      checkpoint,
      transactionHash: approvalHash,
    });
    approval = journal.state.checkpoints[checkpoint].governanceApproval;
  }

  if (!approvalHash) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      null,
      "Governance approval has no durable transaction hash",
      approval
    );
  }
  const raw = await readRawTransaction(approver.token, approvalHash);
  if (transactionSender(raw) !== approver.address || !rawPayloadMatches(raw, expected)) {
    throw new Error(`${checkpoint} APPROVER raw transaction does not exactly match governance payload`);
  }
  journal.updateSubmitted(checkpoint, {
    governanceApproval: {
      ...approval,
      status: "submitted",
      transactionHash: approvalHash,
      rawTransaction: raw,
      rawPayloadVerified: true,
    },
  });
  approval = journal.state.checkpoints[checkpoint].governanceApproval;
  let approvalReceipt = approval.receipt || null;
  if (isPendingReceipt(approvalReceipt)) {
    approvalReceipt = await pollReceipt(
      approver.token,
      approvalHash,
      deadline,
      async (latest) => journal.updateSubmitted(checkpoint, {
        governanceApproval: {
          ...journal.state.checkpoints[checkpoint].governanceApproval,
          receipt: latest,
        },
      })
    );
  }
  if (isPendingReceipt(approvalReceipt)) {
    throw new CheckpointStop(
      checkpoint,
      "pending_governance",
      approvalHash,
      "APPROVER transaction has no terminal receipt",
      approvalReceipt
    );
  }
  if (approvalReceipt.status !== "Success") {
    throw new CheckpointStop(
      checkpoint,
      "failed_governance_receipt",
      approvalHash,
      "APPROVER transaction failed",
      approvalReceipt
    );
  }
  journal.updateSubmitted(checkpoint, {
    governanceApproval: {
      ...journal.state.checkpoints[checkpoint].governanceApproval,
      status: "confirmed",
      receipt: approvalReceipt,
      confirmedAt: new Date().toISOString(),
    },
  });
  console.log(
    `GOVERNANCE_APPROVAL checkpoint=${checkpoint} approver=${approver.address} ` +
    `target=${expected.target} func=${expected.func} args=${stableJson(expected.args)} ` +
    `txHash=${approvalHash}`
  );
  return journal.state.checkpoints[checkpoint].governanceApproval;
}

async function reconcileGovernedSubmission(
  context,
  checkpoint,
  spec,
  actor,
  transactionHash,
  deadline
) {
  const entry = context.journal.state.checkpoints[checkpoint];
  const access = entry.accessControl;
  if (!access || access.governed !== true) {
    return { issueId: null, creation: null, execution: null, executionReceipt: null };
  }
  const expected = entry.governancePayload;
  if (!expected || spec.onlyOwner !== true || spec.governed !== true) {
    throw new Error(`${spec.name} governed submission has no explicit exact payload`);
  }
  let issueId = entry.governanceIssueId || null;
  let creation = entry.governanceIssueCreatedEvent
    ? {
        issueId,
        row: entry.governanceIssueCreatedEvent,
        position: governanceEventPosition(entry.governanceIssueCreatedEvent, "IssueCreated"),
      }
    : null;
  while (!creation && Date.now() < deadline) {
    creation = await findIssueCreated(actor.token, transactionHash, expected);
    if (!creation) {
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
  }
  if (!creation) {
    throw new CheckpointStop(
      checkpoint,
      "pending_governance",
      transactionHash,
      "Exact IssueCreated was not indexed before the governance deadline",
      { governancePayload: expected }
    );
  }
  if (issueId && issueId !== creation.issueId) {
    throw new Error(`Saved governance issue ${issueId} does not match exact IssueCreated`);
  }
  issueId = creation.issueId;
  if (!entry.governanceIssueCreatedEvent) {
    context.journal.updateSubmitted(checkpoint, {
      governanceIssueId: issueId,
      governanceIssueTarget: expected.target,
      governanceIssueFunction: expected.func,
      governanceIssueArguments: expected.args,
      governanceIssueCreationBlock: creation.position.block,
      governanceIssueCreationTimestamp: creation.position.timestamp,
      governanceIssueCreatedEvent: creation.row,
    });
    logGovernanceIssue(checkpoint, transactionHash, creation, expected);
  }

  let current = context.journal.state.checkpoints[checkpoint];
  let execution = await findIssueExecution(actor.token, issueId, creation.row, expected);
  if (!execution && current.governanceExecution) {
    const saved = current.governanceExecution;
    if (!saved.row || !saved.transactionHash ||
        !governanceEventMatches(saved.row, expected) ||
        !governanceEventIsAfter(creation.row, saved.row)) {
      throw new Error(`${checkpoint} saved governance execution is not exact`);
    }
    execution = saved;
  }
  let approval = current.governanceApproval || null;
  const externalExecution = execution &&
    (!approval || !sameTransactionHash(execution.transactionHash, approval.transactionHash));
  if (externalExecution) {
    const reconciliation = externalGovernanceExecutionReconciliation(
      issueId,
      execution,
      approval
    );
    context.journal.updateSubmitted(checkpoint, reconciliation);
    if (reconciliation.governanceCleanupRecommendation) {
      console.warn(
        `GOVERNANCE_CLEANUP_RECOMMENDED checkpoint=${checkpoint} issueId=${issueId} ` +
        `approvalHash=${reconciliation.governanceCleanupRecommendation
          .redundantApprovalTransactionHash} action=${reconciliation
          .governanceCleanupRecommendation.action}`
      );
    }
  } else if (!execution) {
    approval = await approveGovernedSubmission(
      context,
      checkpoint,
      spec,
      actor,
      expected,
      deadline
    );
  }

  while (!execution && Date.now() < deadline) {
    execution = await findIssueExecution(actor.token, issueId, creation.row, expected);
    if (!execution) {
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
  }
  if (!execution) {
    throw new CheckpointStop(
      checkpoint,
      "pending_governance",
      transactionHash,
      `Governance issue ${issueId} has no exact IssueExecuted after APPROVER confirmation`,
      {
        governanceIssueId: issueId,
        governancePayload: expected,
        issueCreated: creation.row,
      }
    );
  }
  if (!externalExecution &&
      !sameTransactionHash(execution.transactionHash, approval.transactionHash)) {
    throw new Error(
      `${checkpoint} IssueExecuted transaction does not match the exact APPROVER call`
    );
  }
  context.journal.updateSubmitted(checkpoint, {
    governanceExecution: execution,
    governanceExecutionTransactionHash: execution.transactionHash,
    governanceExecutionSource: externalExecution
      ? "external_or_manual"
      : "automatic_approval",
  });
  let executionReceipt = context.journal.state.checkpoints[checkpoint]
    .governanceExecutionReceipt || null;
  if (isPendingReceipt(executionReceipt)) {
    executionReceipt = await pollReceipt(
      actor.token,
      execution.transactionHash,
      deadline,
      async (latest) => context.journal.updateSubmitted(checkpoint, {
        governanceExecutionReceipt: latest,
      })
    );
  }
  if (isPendingReceipt(executionReceipt)) {
    throw new CheckpointStop(
      checkpoint,
      "pending_governance",
      execution.transactionHash,
      `Governance execution ${execution.transactionHash} has no terminal receipt`,
      executionReceipt
    );
  }
  if (executionReceipt.status !== "Success") {
    throw new CheckpointStop(
      checkpoint,
      "failed_governance_receipt",
      execution.transactionHash,
      `Governance execution ${execution.transactionHash} failed`,
      executionReceipt
    );
  }
  console.log(
    `GOVERNANCE_EXECUTION checkpoint=${checkpoint} issueId=${issueId} ` +
    `txHash=${execution.transactionHash} status=${executionReceipt.status}`
  );
  return { issueId, creation, execution, executionReceipt };
}

class CheckpointStop extends Error {
  constructor(checkpoint, reason, txHash, message, latestStatus) {
    super(message || reason);
    this.checkpoint = checkpoint;
    this.reason = reason;
    this.txHash = txHash || "none";
    this.latestStatus = jsonValue(latestStatus == null ? null : latestStatus);
  }
}

class RunJournal {
  constructor(filePath, metadata) {
    this.path = path.resolve(filePath);
    this.lockPath = `${this.path}.lock`;
    this.lockFd = null;
    this.lockOwner = null;
    this.metadata = metadata;
    this.state = null;
  }

  acquire() {
    if (this.lockFd != null) throw new Error(`Run-state lock is already held: ${this.lockPath}`);
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const owner = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
    for (;;) {
      try {
        const fd = fs.openSync(this.lockPath, "wx", 0o600);
        try {
          fs.writeFileSync(fd, `${owner}\n`);
          fs.fsyncSync(fd);
        } catch (error) {
          fs.closeSync(fd);
          try {
            fs.unlinkSync(this.lockPath);
          } catch (unlinkError) {
            if (unlinkError.code !== "ENOENT") throw unlinkError;
          }
          throw error;
        }
        this.lockFd = fd;
        this.lockOwner = owner;
        const firstRaw = fs.existsSync(this.path) ? fs.readFileSync(this.path, "utf8") : null;
        const secondRaw = fs.existsSync(this.path) ? fs.readFileSync(this.path, "utf8") : null;
        if (firstRaw !== secondRaw) {
          throw new Error(`Run-state changed while it was being loaded: ${this.path}`);
        }
        this.state = firstRaw == null
          ? {
              schemaVersion: 1,
              createdAt: new Date().toISOString(),
              checkpoints: {},
              interruptions: [],
              ...this.metadata,
            }
          : JSON.parse(firstRaw);
        return;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        let observedOwner;
        try {
          observedOwner = fs.readFileSync(this.lockPath, "utf8").trim();
        } catch (readError) {
          if (readError.code === "ENOENT") continue;
          throw readError;
        }
        const pid = Number(observedOwner.split(":")[0]);
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            throw new Error(`Run-state is locked by process ${pid}: ${this.lockPath}`);
          } catch (pidError) {
            if (pidError.code !== "ESRCH") throw pidError;
          }
        }
        const stalePath = `${this.lockPath}.stale.${process.pid}.${crypto.randomBytes(8).toString("hex")}`;
        try {
          fs.renameSync(this.lockPath, stalePath);
        } catch (renameError) {
          if (renameError.code === "ENOENT") continue;
          throw renameError;
        }
        try {
          fs.unlinkSync(stalePath);
        } catch (unlinkError) {
          if (unlinkError.code !== "ENOENT") throw unlinkError;
        }
      }
    }
  }

  release() {
    if (this.lockFd == null) return;
    fs.closeSync(this.lockFd);
    this.lockFd = null;
    let observedOwner = null;
    try {
      observedOwner = fs.readFileSync(this.lockPath, "utf8").trim();
      if (observedOwner !== this.lockOwner) {
        throw new Error(`Run-state lock ownership changed unexpectedly: ${this.lockPath}`);
      }
      fs.unlinkSync(this.lockPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    } finally {
      this.lockOwner = null;
    }
  }

  save() {
    if (this.lockFd == null || this.state == null) {
      throw new Error(`Run-state must be locked before saving: ${this.path}`);
    }
    this.state.updatedAt = new Date().toISOString();
    atomicWrite(this.path, this.state);
  }

  prepared(id, details) {
    this.state.checkpoints[id] = {
      ...(this.state.checkpoints[id] || {}),
      checkpointId: id,
      status: "prepared",
      preparation: jsonValue(details),
      preparedAt: new Date().toISOString(),
    };
    this.save();
  }

  ready(id, operation) {
    this.state.checkpoints[id] = {
      ...(this.state.checkpoints[id] || {}),
      ...jsonValue(operation),
      checkpointId: id,
      status: "ready",
      preparedAt: new Date().toISOString(),
    };
    this.save();
  }

  dispatching(id, details) {
    Object.assign(this.state.checkpoints[id], jsonValue(details), {
      status: "dispatching",
      dispatchingAt: new Date().toISOString(),
    });
    this.save();
  }

  submitted(id, response) {
    const checkpoint = this.state.checkpoints[id];
    if (!checkpoint.attempts) checkpoint.attempts = [];
    checkpoint.attempts.push({
      ...jsonValue(response),
      submissionTimestamp: new Date().toISOString(),
    });
    Object.assign(checkpoint, jsonValue(response), {
      status: "submitted",
      submissionTimestamp: new Date().toISOString(),
    });
    this.save();
  }

  updateSubmitted(id, values) {
    Object.assign(this.state.checkpoints[id], jsonValue(values), { status: "submitted" });
    this.save();
  }

  confirmed(id, result) {
    Object.assign(this.state.checkpoints[id], jsonValue(result), {
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
    });
    this.save();
  }

  interrupt(id, reason, txHash, latestStatus) {
    this.state.interruptions.push({
      checkpointId: id,
      reason,
      txHash: txHash || null,
      latestStatus: jsonValue(latestStatus),
      at: new Date().toISOString(),
    });
    this.save();
  }
}

function journalEvidence(context) {
  const evidence = {};
  if (context.journal.state.ghostLedger != null) {
    evidence.ghostLedger = jsonValue(context.journal.state.ghostLedger);
  }
  if (context.journal.state.derived != null) {
    evidence.derived = jsonValue(context.journal.state.derived);
  }
  return evidence;
}

async function checkpointEvidence(context, spec, details) {
  const evidence = journalEvidence(context);
  if (spec && spec.captureCheckpointEvidence) {
    evidence.context = jsonValue(await spec.captureCheckpointEvidence(details, context));
  } else if (context.captureCheckpointEvidence) {
    evidence.context = jsonValue(await context.captureCheckpointEvidence(details));
  }
  return Object.keys(evidence).length ? evidence : null;
}

async function expectedPostState(spec, preState, context) {
  const provider = spec.expectedPostState != null
    ? spec.expectedPostState
    : spec.captureExpectedPostState;
  if (provider == null) return null;
  const expected = typeof provider === "function"
    ? await provider.call(spec, preState, context)
    : provider;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error(`${spec.name} expectedPostState must provide a full snapshot object`);
  }
  return jsonValue(expected);
}

async function injectFault(context, point, details) {
  if (typeof context.faultInjector === "function") {
    await context.faultInjector(point, jsonValue(details));
  }
}

async function pollCheckpointReceipt(context, checkpoint, tokenObj, txHash, deadline) {
  let latest = context.journal.state.checkpoints[checkpoint].receipt || null;
  try {
    const polled = await pollReceipt(tokenObj, txHash, deadline, async (receipt) => {
      latest = receipt;
      context.journal.updateSubmitted(checkpoint, {
        receipt,
        latestStatus: receipt,
        lastPolledAt: new Date().toISOString(),
      });
    });
    if (polled == null && latest != null) {
      context.journal.updateSubmitted(checkpoint, {
        receipt: latest,
        latestStatus: latest,
        lastPolledAt: new Date().toISOString(),
      });
    }
    return polled == null ? latest : polled;
  } catch (error) {
    context.journal.updateSubmitted(checkpoint, {
      latestStatus: latest,
      receiptPollError: errorEvidence(error),
      lastPolledAt: new Date().toISOString(),
    });
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      txHash,
      `Receipt polling failed: ${error.message}`,
      latest
    );
  }
}

function persistReceiptTimeout(context, checkpoint, receipt) {
  const latestStatus = receipt == null
    ? { phase: "receipt_poll", outcome: "no_result", receipt: null }
    : receipt;
  context.journal.updateSubmitted(checkpoint, {
    receipt: receipt == null ? null : receipt,
    latestStatus,
    lastPolledAt: new Date().toISOString(),
  });
  return latestStatus;
}

function safeAbsentSubmission(entry) {
  return entry.submissionOutcome === "terminal_failed_without_hash";
}

function exactSnapshot(expected, observed) {
  return snapshotDiff(expected, observed).length === 0;
}

function feePaymentRule(context, spec) {
  const policy = context.feePolicy;
  if (!policy || normalizeAddress(policy.feeToken, "fee token") !== context.addresses.ASSET) {
    return null;
  }
  const actorAddress = context.addresses[spec.actor];
  if (!actorAddress) throw new Error(`Fee-paying actor ${spec.actor} has no configured address`);
  const reviewedFeeWei = bigint(policy.feeWei, "reviewed fee amount");
  return {
    actor: spec.actor,
    actorAddress: normalizeAddress(actorAddress, `${spec.actor} address`),
    feeToken: normalizeAddress(policy.feeToken, "fee token"),
    reviewedFeeWei: reviewedFeeWei.toString(),
    allowedDebits: ["0", reviewedFeeWei.toString()],
    evidenceSource: "exact actor fee-token balance delta",
  };
}

function reconcileFeeAdjustedState(economicState, observedState, context, spec, label) {
  if (!economicState) {
    throw new Error(`${label || spec.name} has no economic expected state to reconcile`);
  }
  const rule = feePaymentRule(context, spec);
  if (!rule) {
    const differences = snapshotDiff(economicState, observedState);
    return {
      matched: differences.length === 0,
      expectedPostState: jsonValue(economicState),
      feePaymentEvidence: null,
      differences,
    };
  }
  const expected = JSON.parse(stableJson(economicState));
  const economicBalance = bigint(
    economicState.underlying && economicState.underlying[rule.actor],
    `${rule.actor} economic fee-token balance`
  );
  const observedBalance = bigint(
    observedState.underlying && observedState.underlying[rule.actor],
    `${rule.actor} observed fee-token balance`
  );
  const debit = economicBalance - observedBalance;
  const reviewedFee = bigint(rule.reviewedFeeWei);
  if (debit !== 0n && debit !== reviewedFee) {
    return {
      matched: false,
      expectedPostState: expected,
      feePaymentEvidence: {
        ...rule,
        debit: debit.toString(),
        mode: "invalid",
      },
      differences: [{
        field: `underlying.${rule.actor}`,
        expected: `${economicBalance} minus one of ${rule.allowedDebits.join(",")}`,
        observed: observedBalance.toString(),
      }],
    };
  }
  expected.underlying[rule.actor] = observedBalance.toString();
  const differences = snapshotDiff(expected, observedState);
  return {
    matched: differences.length === 0,
    expectedPostState: expected,
    feePaymentEvidence: {
      ...rule,
      economicBalance: economicBalance.toString(),
      observedBalance: observedBalance.toString(),
      debit: debit.toString(),
      mode: debit === 0n ? "voucher" : "fee-token",
      matchedFullState: differences.length === 0,
    },
    differences,
  };
}

function actorEconomicDelta(result, postState, actor) {
  const actual = bigint(postState.underlying[actor]) - bigint(result.preState.underlying[actor]);
  const evidence = result.feePaymentEvidence || result.feePayment || null;
  const fee = evidence && evidence.actor === actor ? bigint(evidence.debit || 0) : 0n;
  return actual + fee;
}

function remainingCheckpointRequirements(
  orderedCheckpoints,
  start,
  specs,
  journalState,
  flows = {},
  currentState = null,
  context = null
) {
  const startIndex = orderedCheckpoints.indexOf(start);
  if (startIndex < 0) throw new Error(`Unknown checkpoint ${start}`);
  const calls = {};
  const running = {};
  const minimum = {};
  const included = [];
  for (const checkpoint of orderedCheckpoints.slice(startIndex)) {
    const entry = journalState.checkpoints && journalState.checkpoints[checkpoint];
    if (entry && ["confirmed", "submitted"].includes(entry.status)) continue;
    if (entry && entry.status === "dispatching" && currentState) {
      const exactPost = entry.expectedPostState &&
        exactSnapshot(entry.expectedPostState, currentState);
      const feeAdjustedPost = context && specs[checkpoint] &&
        entry.economicExpectedPostState &&
        reconcileFeeAdjustedState(
          entry.economicExpectedPostState,
          currentState,
          context,
          specs[checkpoint],
          `${specs[checkpoint].name} funding recovery state`
        ).matched;
      if (exactPost || feeAdjustedPost) continue;
    }
    included.push(checkpoint);
    const spec = specs[checkpoint];
    if (spec && !spec.noTransaction) {
      calls[spec.actor] = (calls[spec.actor] || 0n) + 1n;
    }
    for (const flow of flows[checkpoint] || []) {
      running[flow.actor] = (running[flow.actor] || 0n) + bigint(flow.delta);
      minimum[flow.actor] = minimum[flow.actor] == null
        ? running[flow.actor]
        : running[flow.actor] < minimum[flow.actor]
          ? running[flow.actor]
          : minimum[flow.actor];
    }
  }
  const underlying = Object.fromEntries(
    Object.entries(minimum).map(([actor, value]) => [actor, value < 0n ? -value : 0n])
  );
  return { calls, underlying, included };
}

function accountSequence(row) {
  if (!row || typeof row !== "object") return null;
  for (const key of ["nonce", "accountSequence", "sequenceNumber", "account_sequence"]) {
    if (row[key] != null && /^\d+$/.test(String(row[key]))) return String(row[key]);
  }
  return null;
}

function transactionSender(row) {
  if (!row || typeof row !== "object") return null;
  const value = field(row, ["from", "sender", "signer"], null);
  try {
    return normalizeAddress(value, "transaction sender");
  } catch (_) {
    return null;
  }
}

function transactionHash(row) {
  return row && field(row, ["hash", "transactionHash", "transaction_hash", "txHash"], null);
}

function sameTransactionHash(left, right) {
  return String(left || "").replace(/^0x/i, "").toLowerCase() ===
    String(right || "").replace(/^0x/i, "").toLowerCase();
}

function externalGovernanceExecutionReconciliation(issueId, execution, approval) {
  const executionHash = execution && execution.transactionHash;
  if (!issueId || !executionHash) {
    throw new Error("External governance reconciliation requires issue and execution hashes");
  }
  const approvalHash = approval && approval.transactionHash || null;
  const details = {
    governanceExecution: execution,
    governanceExecutionTransactionHash: executionHash,
    governanceExecutionSource: "external_or_manual",
    automaticGovernanceApprovalSkipped: true,
  };
  if (!approval || sameTransactionHash(approvalHash, executionHash)) return details;

  details.governanceApproval = {
    ...approval,
    status: "redundant_after_external_execution",
    externalExecutionTransactionHash: executionHash,
    reconciledAt: new Date().toISOString(),
  };
  if (approvalHash) {
    details.governanceCleanupRecommendation = {
      issueId,
      externalExecutionTransactionHash: executionHash,
      redundantApprovalTransactionHash: approvalHash,
      mayHaveReopenedDeterministicIssue: true,
      action:
        `Check AdminRegistry.currentIssues[${issueId}]. If true, manually dismiss the ` +
        "duplicate issue with its proposer; do not submit this governed operation again.",
    };
  }
  return details;
}

function matchingNonceRows(rows, actorAddress, nonce) {
  const actor = normalizeAddress(actorAddress);
  return rows.filter((row) =>
    transactionSender(row) === actor && accountSequence(row) === String(nonce)
  );
}

async function readAccountSubmissionState(tokenObj, actorAddress) {
  const params = { address: normalizeAddress(actorAddress), limit: "2" };
  const response = await axios.get(`${rootNodeUrl()}/strato-api/eth/v1.2/account`, {
    headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
    params,
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  return {
    endpoint: "/strato-api/eth/v1.2/account",
    params,
    rowCount: rows.length,
    sequence: rows.length === 1 ? accountSequence(rows[0]) : null,
  };
}

async function lookupRawSubmission(tokenObj, actorAddress, nonce) {
  if (nonce == null) {
    return {
      rows: [],
      queuedRows: [],
      transactionHash: null,
      lookupPerformed: false,
      queuedLookupPerformed: false,
    };
  }
  const endpoint = "/strato-api/eth/v1.2/transaction";
  const queuedEndpoint = "/strato-api/eth/v1.2/transaction/last/queued";
  const limit = 100;
  const maxPages = 5;
  const scannedRows = [];
  const pageParams = [];
  try {
    for (let page = 0; page < maxPages; page++) {
      const params = {
        from: normalizeAddress(actorAddress),
        limit: String(limit),
        offset: String(page * limit),
        sortby: "desc",
      };
      pageParams.push(params);
      const response = await axios.get(`${rootNodeUrl()}${endpoint}`, {
        headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
        params,
      });
      const pageRows = Array.isArray(response.data) ? response.data : [];
      scannedRows.push(...pageRows);
      if (pageRows.length < limit) break;
    }
    const rows = matchingNonceRows(scannedRows, actorAddress, nonce);
    let queuedRows = [];
    let queuedLookupPerformed = false;
    let queuedError = null;
    try {
      const queuedResponse = await axios.get(`${rootNodeUrl()}${queuedEndpoint}`, {
        headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
      });
      const queued = Array.isArray(queuedResponse.data) ? queuedResponse.data : [];
      queuedRows = matchingNonceRows(queued, actorAddress, nonce);
      queuedLookupPerformed = true;
    } catch (error) {
      if (!error.response || ![400, 404].includes(error.response.status)) throw error;
      queuedError = errorEvidence(error);
    }
    const matches = [...rows, ...queuedRows];
    const uniqueHashes = [...new Set(matches.map(transactionHash).filter(Boolean))];
    return {
      endpoint,
      pageParams,
      scannedRowCount: scannedRows.length,
      rows: jsonValue(rows),
      queuedEndpoint,
      queuedRows: jsonValue(queuedRows),
      queuedLookupPerformed,
      queuedError,
      transactionHash: uniqueHashes.length === 1 ? uniqueHashes[0] : null,
      lookupPerformed: true,
    };
  } catch (error) {
    if (error.response && [400, 404].includes(error.response.status)) {
      return {
        endpoint,
        pageParams,
        rows: [],
        queuedRows: [],
        transactionHash: null,
        lookupPerformed: false,
        queuedLookupPerformed: false,
        unsupported: true,
        error: errorEvidence(error),
      };
    }
    throw error;
  }
}

async function defaultConfirmSubmissionAbsent(entry, _currentState, context) {
  const actor = context.actors[entry.actor];
  if (!actor) return { absent: false, reason: "actor unavailable" };
  const submittedNonce = entry.submittedNonce == null
    ? entry.preSubmissionSequence
    : String(entry.submittedNonce);
  const [account, lookup] = await Promise.all([
    readAccountSubmissionState(actor.token, actor.address),
    lookupRawSubmission(actor.token, actor.address, submittedNonce),
  ]);
  const absent = submittedNonce != null &&
    account.sequence === String(submittedNonce) &&
    lookup.lookupPerformed &&
    lookup.queuedLookupPerformed &&
    lookup.rows.length === 0 &&
    lookup.queuedRows.length === 0;
  return {
    absent,
    submittedNonce,
    account,
    lookup,
    conclusion: absent
      ? "account sequence did not advance and bounded confirmed/queued lookups found no exact nonce"
      : "submission absence could not be proven",
  };
}

async function locateSubmissionHash(entry, context) {
  if (entry.transactionHash) return {
    transactionHash: entry.transactionHash,
    source: "journal",
  };
  const actor = context.actors[entry.actor];
  if (!actor) return null;
  const nonce = entry.submittedNonce == null
    ? entry.preSubmissionSequence
    : String(entry.submittedNonce);
  const lookup = await lookupRawSubmission(actor.token, actor.address, nonce);
  return lookup.transactionHash
    ? { transactionHash: lookup.transactionHash, source: "raw-transaction-nonce", lookup }
    : null;
}

async function submitCall(context, spec, checkpoint, preState) {
  const actor = context.actors[spec.actor];
  if (!actor) throw new Error(`No authenticated actor named ${spec.actor}`);
  const contractAddress = context.addresses[spec.contract];
  if (!contractAddress) throw new Error(`No address configured for ${spec.contract}`);
  const onlyOwner = assertMarkedOnlyOwner(spec);
  if (onlyOwner && !registeredCheckpoint(
    context.registryScope,
    checkpoint,
    spec.registryContract,
    spec.method
  )) {
    throw new Error(
      `Unregistered ${context.registryScope} onlyOwner checkpoint ` +
      `${checkpoint} ${spec.registryContract}.${spec.method}`
    );
  }
  if (onlyOwner && spec.actor !== "OWNER") {
    throw new Error(`${spec.name} onlyOwner operation must use authenticated OWNER signer`);
  }
  if (onlyOwner && (!context.ownerAuthority || context.ownerAuthority.verified !== true)) {
    throw new Error(`${spec.name} has no verified signer/storage-owner authority`);
  }
  const resolvedArgs = jsonValue(
    typeof spec.args === "function" ? spec.args(preState, context) : spec.args || {}
  );
  const governancePayload = onlyOwner
    ? {
        target: normalizeAddress(contractAddress),
        func: spec.method,
        args: positionalArguments(spec.registryContract, spec.method, resolvedArgs),
      }
    : null;
  const callArgs = {
    contract: { address: contractAddress, name: spec.contractName },
    method: spec.method,
    args: resolvedArgs,
    txParams: { gasPrice: config.gasPrice, gasLimit: config.gasLimit },
  };
  const economicExpectedPostState = await expectedPostState(spec, preState, context);
  const precommittedFeePaymentRule = feePaymentRule(context, spec);
  const fullExpectedPostState = precommittedFeePaymentRule
    ? null
    : economicExpectedPostState;
  let accountBeforeSubmission;
  try {
    accountBeforeSubmission = await readAccountSubmissionState(actor.token, actor.address);
  } catch (error) {
    accountBeforeSubmission = { error: errorEvidence(error), sequence: null };
  }
  context.journal.ready(checkpoint, {
    operation: spec.name,
    actor: spec.actor,
    actorAddress: actor.address,
    contract: spec.contract,
    contractAddress,
    method: spec.method,
    arguments: callArgs.args,
    expectedPreState: preState,
    economicExpectedPostState,
    expectedPostState: fullExpectedPostState,
    expectedPostStateRules: spec.postRules || [],
    accessControl: onlyOwner
      ? {
          onlyOwner: true,
          governed: context.ownerAuthority.mode === "admin-registry",
          registryContract: spec.registryContract,
          authority: context.ownerAuthority,
          governancePayload,
        }
      : {
          onlyOwner: false,
          governed: false,
        },
    governancePayload,
    feePaymentRule: precommittedFeePaymentRule,
    preSubmissionSequence: accountBeforeSubmission.sequence,
    preSubmissionAccountEvidence: accountBeforeSubmission,
    readyEvidence: await checkpointEvidence(context, spec, {
      checkpoint,
      phase: "ready",
      preState,
    }),
    submissionAttempt: callArgs,
  });
  await injectFault(context, "after_ready", { checkpoint, callArgs });
  context.journal.dispatching(checkpoint, {
    dispatchAttempt: Number(context.journal.state.checkpoints[checkpoint].dispatchAttempt || 0) + 1,
  });
  await injectFault(context, "after_dispatching", { checkpoint, callArgs });
  let response;
  try {
    response = await rest.call(actor.token, callArgs, {
      config,
      cacheNonce: false,
      isAsync: true,
    });
  } catch (error) {
    const message = String(error && error.message || error);
    const nonceCollision = /nonce|account sequence|sequence number/i.test(message);
    const reason = nonceCollision
      ? "nonce_collision"
      : "unknown_status";
    context.journal.submitted(checkpoint, {
      transactionHash: null,
      submittedNonce: submissionNonce(error),
      submissionError: errorEvidence(error),
      rawSubmissionError: errorEvidence(error),
      submissionOutcome: "ambiguous_without_hash",
      latestStatus: {
        phase: "submission",
        outcome: "ambiguous_without_hash",
        nonceCollision,
        error: errorEvidence(error),
      },
    });
    throw new CheckpointStop(
      checkpoint,
      reason,
      null,
      message,
      context.journal.state.checkpoints[checkpoint].latestStatus
    );
  }
  const txHash = receiptHash(response);
  if (!txHash) {
    const responseValue = Array.isArray(response) ? response[0] : response;
    const responseStatus = responseValue && responseValue.status;
    const terminalFailure = responseStatus && responseStatus !== "Pending" &&
      responseStatus !== "Success";
    context.journal.submitted(checkpoint, {
      transactionHash: null,
      submittedNonce: submissionNonce(response),
      rawSubmission: response,
      submissionOutcome: terminalFailure
        ? "terminal_failed_without_hash"
        : "ambiguous_without_hash",
      latestStatus: {
        phase: "submission",
        outcome: terminalFailure ? "terminal_failed_without_hash" : "ambiguous_without_hash",
        response,
      },
    });
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      null,
      `No transaction hash: ${stableJson(response)}`,
      context.journal.state.checkpoints[checkpoint].latestStatus
    );
  }
  context.journal.submitted(checkpoint, {
    transactionHash: txHash,
    submittedNonce: submissionNonce(response),
    rawSubmission: response,
    submissionOutcome: "hash_returned",
    latestStatus: { phase: "submission", outcome: "hash_returned", transactionHash: txHash },
  });
  await injectFault(context, "after_submitted", { checkpoint, txHash, response });
  return { actor, callArgs, txHash };
}

async function collectCheckpointEvents(
  context,
  checkpoint,
  spec,
  actor,
  receipt,
  transactionHash,
  governanceIssueId,
  createdAfter,
  deadline
) {
  const requiredEvents = spec.events || [];
  const queriedEvents = [...new Set([...requiredEvents, ...(spec.optionalEvents || [])])];
  let eventTxHash = context.journal.state.checkpoints[checkpoint]
    .governanceExecutionTransactionHash || transactionHash;
  let governanceExecution = context.journal.state.checkpoints[checkpoint]
    .governanceExecution || null;
  let events = [];
  let missingEvents = requiredEvents;
  try {
    do {
      events = mergeEvents(
        events,
        await fetchEvents(
          actor.token,
          spec.contractName,
          queriedEvents,
          eventTxHash,
          context.addresses[spec.contract]
        )
      );
      const observedNames = new Set(
        events
          .filter((event) => eventBelongsTo(event, context.addresses[spec.contract]))
          .map((event) => event.eventName)
      );
      missingEvents = requiredEvents.filter((eventName) => !observedNames.has(eventName));
      context.journal.updateSubmitted(checkpoint, {
        receipt,
        observedEvents: events,
        missingExpectedEvents: missingEvents,
        eventTransactionHash: eventTxHash,
        governanceExecutionTransactionHash:
          governanceExecution && governanceExecution.transactionHash ||
          context.journal.state.checkpoints[checkpoint].governanceExecutionTransactionHash ||
          null,
        latestStatus: {
          phase: "indexing",
          receipt,
          eventTransactionHash: eventTxHash,
          observedEventCount: events.length,
          missingExpectedEvents: missingEvents,
        },
      });
      if (missingEvents.length && Date.now() < deadline) {
        await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
      }
    } while (missingEvents.length && Date.now() < deadline);
  } catch (error) {
    const latestStatus = {
      phase: "indexing",
      receipt,
      eventTransactionHash: eventTxHash,
      observedEventCount: events.length,
      missingExpectedEvents: missingEvents,
      error: errorEvidence(error),
    };
    context.journal.updateSubmitted(checkpoint, {
      receipt,
      observedEvents: events,
      missingExpectedEvents: missingEvents,
      indexingError: errorEvidence(error),
      latestStatus,
    });
    throw new CheckpointStop(
      checkpoint,
      governanceIssueId ? "pending_governance" : "unknown_status",
      transactionHash,
      `Event indexing could not be reconciled: ${error.message}`,
      latestStatus
    );
  }
  if (missingEvents.length) {
    const latestStatus = {
      phase: "indexing",
      receipt,
      eventTransactionHash: eventTxHash,
      observedEventCount: events.length,
      missingExpectedEvents: missingEvents,
    };
    throw new CheckpointStop(
      checkpoint,
      governanceIssueId ? "pending_governance" : "unknown_status",
      transactionHash,
      `Missing expected events for ${spec.name}: ${missingEvents.join(", ")}`,
      latestStatus
    );
  }
  return { events, governanceExecution };
}

function assertCheckpointEvents(
  context,
  checkpoint,
  spec,
  events,
  receipt,
  preState,
  postState,
  transactionHash
) {
  if (!spec.assertEvents) return;
  try {
    spec.assertEvents(events, receipt, preState, postState, context);
  } catch (error) {
    const latestStatus = {
      phase: "indexing",
      receipt,
      observedEventCount: events.length,
      eventAssertionError: errorEvidence(error),
    };
    context.journal.updateSubmitted(checkpoint, {
      receipt,
      observedEvents: events,
      eventAssertionError: errorEvidence(error),
      latestStatus,
    });
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      transactionHash,
      `Indexed event evidence could not be reconciled: ${error.message}`,
      latestStatus
    );
  }
}

async function replacementIsSafe(spec, entry, currentState, context) {
  if (safeAbsentSubmission(entry)) {
    return {
      kind: "submission_absent",
      submissionOutcome: entry.submissionOutcome,
      latestStatus: entry.latestStatus,
    };
  }
  if (isFailedReceipt(entry.receipt)) {
    return { kind: "terminal_failed_receipt", receipt: entry.receipt };
  }
  const confirm = spec.confirmSubmissionAbsent || defaultConfirmSubmissionAbsent;
  const evidence = await confirm(entry, currentState, context);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("confirmSubmissionAbsent must return an evidence object");
  }
  if (evidence.absent !== true) return null;
  return { kind: "caller_confirmed_absent", evidence: jsonValue(evidence) };
}

async function permitReplacement(context, checkpoint, spec, entry, currentState) {
  const differences = snapshotDiff(entry.expectedPreState, currentState);
  if (differences.length) {
    console.error(`CHECKPOINT_STATE_MISMATCH checkpoint=${checkpoint} differences=${stableJson(differences)}`);
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      entry.transactionHash,
      "Replacement is unsafe because live state does not exactly match saved pre-state",
      entry.latestStatus
    );
  }
  const safetyEvidence = await replacementIsSafe(spec, entry, currentState, context);
  if (!safetyEvidence) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      entry.transactionHash,
      "Submission outcome is ambiguous; confirmSubmissionAbsent metadata is required before replacement",
      entry.latestStatus
    );
  }
  const actor = context.actors[entry.actor];
  let nonceRefreshEvidence;
  try {
    nonceRefreshEvidence = await readAccountSubmissionState(actor.token, actor.address);
  } catch (error) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      entry.transactionHash,
      `Replacement nonce/account-sequence refresh failed: ${error.message}`,
      errorEvidence(error)
    );
  }
  const replacementCount = Number(entry.replacementCount || 0) + 1;
  if (replacementCount > 1) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      entry.transactionHash,
      "Checkpoint already used its one permitted replacement submission",
      entry.latestStatus
    );
  }
  entry.replacementCount = replacementCount;
  entry.replacementAuthorizedAt = new Date().toISOString();
  entry.replacementSafetyEvidence = jsonValue(safetyEvidence);
  entry.replacementNonceRefreshEvidence = jsonValue(nonceRefreshEvidence);
  context.journal.save();
}

async function confirmExpectedFailure(
  context,
  checkpoint,
  nextCheckpoint,
  spec,
  receipt,
  preState,
  transactionHash
) {
  if (receipt.status === "Success") {
    throw new Error(`${spec.name} unexpectedly succeeded`);
  }
  if (spec.expectedFailurePattern &&
      !spec.expectedFailurePattern.test(stableJson(receipt))) {
    throw new Error(`${spec.name} failed for an unexpected reason: ${stableJson(receipt)}`);
  }
  const savedPreState = context.journal.state.checkpoints[checkpoint].expectedPreState;
  const reconciliation = reconcileFeeAdjustedState(
    savedPreState,
    preState,
    context,
    spec,
    `${spec.name} failed-call state`
  );
  if (!reconciliation.matched) {
    throw new Error(`Failed call changed economic state: ${stableJson(reconciliation.differences)}`);
  }
  const result = {
    transactionHash,
    receipt,
    confirmedBlock: confirmedBlock(receipt),
    confirmedPostState: preState,
    expectedPostState: reconciliation.expectedPostState,
    feePaymentEvidence: reconciliation.feePaymentEvidence,
    observedEvents: [],
    expectedFailureConfirmed: true,
    nextCheckpointId: nextCheckpoint,
    confirmedEvidence: await checkpointEvidence(context, spec, {
      checkpoint,
      phase: "confirmed",
      preState: savedPreState,
      postState: preState,
      receipt,
    }),
  };
  context.journal.confirmed(checkpoint, result);
  trace(checkpoint, "exit", preState, spec.traceFields || []);
  console.log(`CHECKPOINT_CONFIRMED checkpoint=${checkpoint} next=${nextCheckpoint} runState=${context.journal.path}`);
  return context.journal.state.checkpoints[checkpoint];
}

async function executeCheckpoint(context, checkpoint, nextCheckpoint, spec, invocationDeadline) {
  const deadline = invocationDeadline || Date.now() + POLL_LIMIT_MS;
  let existing = context.journal.state.checkpoints[checkpoint];
  let preState = await context.capture();
  trace(checkpoint, "entry", preState, spec.traceFields || []);
  if (!spec.noTransaction) {
    const onlyOwner = assertMarkedOnlyOwner(spec);
    if (onlyOwner && !registeredCheckpoint(
      context.registryScope,
      checkpoint,
      spec.registryContract,
      spec.method
    )) {
      throw new Error(
        `Unregistered ${context.registryScope} onlyOwner checkpoint ` +
        `${checkpoint} ${spec.registryContract}.${spec.method}`
      );
    }
  }

  if (existing && existing.status === "confirmed") {
    if (!existing.confirmedPostState ||
        !exactSnapshot(existing.confirmedPostState, preState)) {
      const differences = snapshotDiff(existing.confirmedPostState, preState);
      console.error(`CHECKPOINT_STATE_MISMATCH checkpoint=${checkpoint} differences=${stableJson(differences)}`);
      throw new Error(`Live state does not exactly match confirmed checkpoint ${checkpoint}`);
    }
    if (spec.assertPost) spec.assertPost(preState, existing, context);
    trace(checkpoint, "exit", preState, spec.traceFields || []);
    return existing;
  }

  if ((!existing || existing.status !== "submitted") && spec.assertPre) {
    spec.assertPre(preState, existing, context);
  }

  if (spec.noTransaction) {
    context.journal.ready(checkpoint, {
      operation: spec.name,
      actor: spec.actor || null,
      expectedPreState: preState,
      expectedPostStateRules: spec.postRules || [],
      readyEvidence: await checkpointEvidence(context, spec, {
        checkpoint,
        phase: "ready",
        preState,
      }),
    });
    if (spec.assertPost) spec.assertPost(preState, null, context);
    const result = {
      confirmedPostState: preState,
      observedEvents: [],
      nextCheckpointId: nextCheckpoint,
      confirmedEvidence: await checkpointEvidence(context, spec, {
        checkpoint,
        phase: "confirmed",
        preState,
        postState: preState,
        receipt: null,
      }),
    };
    context.journal.confirmed(checkpoint, result);
    trace(checkpoint, "exit", preState, spec.traceFields || []);
    console.log(`CHECKPOINT_CONFIRMED checkpoint=${checkpoint} next=${nextCheckpoint} runState=${context.journal.path}`);
    return result;
  }

  if (existing && ["dispatching", "submitted"].includes(existing.status) &&
      !existing.transactionHash) {
    const located = await locateSubmissionHash(existing, context);
    if (located) {
      context.journal.submitted(checkpoint, {
        transactionHash: located.transactionHash,
        recoveredSubmissionEvidence: located,
        submissionOutcome: "recovered_hash",
        latestStatus: {
          phase: "recovery",
          outcome: "located_submission_before_state_reconciliation",
          transactionHash: located.transactionHash,
        },
      });
      existing = context.journal.state.checkpoints[checkpoint];
    }
  }

  if (existing && ["dispatching", "submitted"].includes(existing.status) &&
      !existing.expectedPostState && existing.economicExpectedPostState) {
    const reconciliation = reconcileFeeAdjustedState(
      existing.economicExpectedPostState,
      preState,
      context,
      spec,
      `${spec.name} recoverable post-state`
    );
    if (reconciliation.matched) {
      const recoveredExpectation = {
        expectedPostState: reconciliation.expectedPostState,
        feePaymentEvidence: reconciliation.feePaymentEvidence,
        feeReconciledAt: new Date().toISOString(),
      };
      if (existing.status === "submitted") {
        context.journal.updateSubmitted(checkpoint, recoveredExpectation);
      } else {
        Object.assign(existing, jsonValue(recoveredExpectation));
        context.journal.save();
      }
      existing = context.journal.state.checkpoints[checkpoint];
    }
  }

  if (existing && ["dispatching", "submitted"].includes(existing.status) &&
      existing.expectedPostState && exactSnapshot(existing.expectedPostState, preState)) {
    const located = await locateSubmissionHash(existing, context);
    if (!located) {
      throw new CheckpointStop(
        checkpoint,
        "unknown_status",
        null,
        "Exact post-state exists, but durable receipt evidence could not be located; refusing replay",
        { phase: existing.status, exactPostState: true }
      );
    }
    const recovered = {
      transactionHash: located.transactionHash,
      recoveredSubmissionEvidence: existing.recoveredSubmissionEvidence || located,
      submissionOutcome: "recovered_hash",
      latestStatus: {
        phase: "recovery",
        outcome: "exact_post_state_with_located_submission",
        transactionHash: located.transactionHash,
      },
    };
    if (existing.status === "submitted" && existing.transactionHash) {
      context.journal.updateSubmitted(checkpoint, recovered);
    } else {
      context.journal.submitted(checkpoint, recovered);
    }
    existing = context.journal.state.checkpoints[checkpoint];
  }

  if (existing && existing.status === "dispatching") {
    const preDifferences = snapshotDiff(existing.expectedPreState, preState);
    const postDifferences = existing.expectedPostState
      ? snapshotDiff(existing.expectedPostState, preState)
      : null;
    Object.assign(existing, jsonValue({
      latestObservedState: preState,
      preStateDifferences: preDifferences,
      postStateDifferences: postDifferences,
    }));
    context.journal.save();
    await permitReplacement(context, checkpoint, spec, existing, preState);
  }

  if (existing && existing.status === "submitted") {
    const hash = existing.transactionHash;
    let receipt = existing.receipt || null;
    if (hash && isPendingReceipt(receipt)) {
      receipt = await pollCheckpointReceipt(
        context,
        checkpoint,
        context.actors[spec.actor].token,
        hash,
        deadline
      );
    }
    existing = context.journal.state.checkpoints[checkpoint];
    if (hash && isPendingReceipt(receipt)) {
      const latestStatus = persistReceiptTimeout(context, checkpoint, receipt);
      throw new CheckpointStop(
        checkpoint,
        "timeout",
        hash,
        "Previously submitted transaction remains pending",
        latestStatus
      );
    }
    if (spec.expectFailure && receipt && !isPendingReceipt(receipt)) {
      return confirmExpectedFailure(
        context,
        checkpoint,
        nextCheckpoint,
        spec,
        receipt,
        preState,
        hash
      );
    }
    if (!hash || isFailedReceipt(receipt)) {
      await permitReplacement(context, checkpoint, spec, existing, preState);
    } else if (receipt && receipt.status === "Success") {
      const savedPreState = existing.expectedPreState;
      const actor = context.actors[spec.actor];
      const reconciliationDeadline = deadline;
      const governed = await reconcileGovernedSubmission(
        context,
        checkpoint,
        spec,
        actor,
        hash,
        reconciliationDeadline
      );
      const governanceIssueId = governed.issueId;
      existing = context.journal.state.checkpoints[checkpoint];
      preState = await context.capture();

      let events = null;
      let governanceExecution = governed.execution;
      const collectEvents = async () => {
        const collected = await collectCheckpointEvents(
          context,
          checkpoint,
          spec,
          actor,
          receipt,
          hash,
          governanceIssueId,
          existing.submissionTimestamp,
          reconciliationDeadline
        );
        events = collected.events;
        governanceExecution = collected.governanceExecution;
      };

      if (reconcileFeeAdjustedState(
        savedPreState,
        preState,
        context,
        spec,
        `${spec.name} pending state`
      ).matched) {
        if (governanceIssueId) {
          await collectEvents();
          preState = await context.capture();
        }
      }
      const stillMatchesSavedPreState = reconcileFeeAdjustedState(
        savedPreState,
        preState,
        context,
        spec,
        `${spec.name} pending state`
      ).matched;
      const savedExpectedPostState = existing.economicExpectedPostState ||
        existing.expectedPostState || null;
      const matchesSavedExpectedPostState = !governanceIssueId &&
        savedExpectedPostState &&
        reconcileFeeAdjustedState(
          savedExpectedPostState,
          preState,
          context,
          spec,
          `${spec.name} submitted post-state`
        ).matched;
      if (stillMatchesSavedPreState && !matchesSavedExpectedPostState) {
        throw new CheckpointStop(
          checkpoint,
          "pending_governance",
          hash,
          governanceIssueId
            ? `Governance issue ${governanceIssueId} has not activated the expected state`
            : "Receipt succeeded but live state still exactly matches saved pre-state",
          {
            receipt,
            governanceIssueId,
            observedEvents: events || [],
          }
        );
      }

      let economicPostState = existing.economicExpectedPostState ||
        existing.expectedPostState || null;
      if (!economicPostState && typeof spec.reconcileSubmittedPostState === "function") {
        if (!events) await collectEvents();
        economicPostState = await spec.reconcileSubmittedPostState(
          {
            checkpoint,
            transactionHash: hash,
            preState: savedPreState,
            observedState: preState,
            receipt,
            events,
            governanceIssueId,
            governanceExecution,
          },
          context
        );
        if (!economicPostState || typeof economicPostState !== "object" ||
            Array.isArray(economicPostState)) {
          throw new Error(
            `${spec.name} reconcileSubmittedPostState must return a full snapshot object`
          );
        }
        economicPostState = jsonValue(economicPostState);
      }

      if (!economicPostState) {
        throw new CheckpointStop(
          checkpoint,
          "unknown_status",
          hash,
          "Successful submission has no full receipt/event-derived expected post-state",
          receipt
        );
      }
      const reconciliation = reconcileFeeAdjustedState(
        economicPostState,
        preState,
        context,
        spec,
        `${spec.name} submitted post-state`
      );
      context.journal.updateSubmitted(checkpoint, {
        economicExpectedPostState: economicPostState,
        expectedPostState: reconciliation.expectedPostState,
        feePaymentEvidence: reconciliation.feePaymentEvidence,
        receiptEventReconciledAt: new Date().toISOString(),
      });
      existing = context.journal.state.checkpoints[checkpoint];
      if (!reconciliation.matched) {
        context.journal.updateSubmitted(checkpoint, {
          latestObservedPostState: preState,
          postStateDifferences: reconciliation.differences,
        });
        throw new CheckpointStop(
          checkpoint,
          existing.governanceIssueId ? "pending_governance" : "unknown_status",
          hash,
          "Live state does not exactly match the saved full expected post-state",
          {
            receipt,
            postStateDifferences: reconciliation.differences,
          }
        );
      }
      const verificationReceipt = governed.executionReceipt || receipt;
      const verificationHash = governed.execution && governed.execution.transactionHash || hash;
      if (spec.assertPost) {
        spec.assertPost(preState, {
          receipt: verificationReceipt,
          preState: savedPreState,
          feePaymentEvidence: reconciliation.feePaymentEvidence,
        }, context);
      }
      if (!events) await collectEvents();
      assertCheckpointEvents(
        context,
        checkpoint,
        spec,
        events,
        verificationReceipt,
        savedPreState,
        preState,
        verificationHash
      );
      if (spec.afterConfirm) {
        spec.afterConfirm(savedPreState, preState, verificationReceipt, events, context);
      }
      context.journal.confirmed(checkpoint, {
        reconciledWithoutResubmission: true,
        receipt,
        confirmedBlock: confirmedBlock(verificationReceipt, events),
        confirmedPostState: preState,
        expectedPostState: reconciliation.expectedPostState,
        feePaymentEvidence: reconciliation.feePaymentEvidence,
        observedEvents: events,
        governanceExecutionTransactionHash:
          governanceExecution && governanceExecution.transactionHash ||
          existing.governanceExecutionTransactionHash || null,
        nextCheckpointId: nextCheckpoint,
        confirmedEvidence: await checkpointEvidence(context, spec, {
          checkpoint,
          phase: "confirmed",
          preState: savedPreState,
          postState: preState,
          receipt: verificationReceipt,
          events,
        }),
      });
      trace(checkpoint, "exit", preState, spec.traceFields || []);
      console.log(`CHECKPOINT_CONFIRMED checkpoint=${checkpoint} next=${nextCheckpoint} runState=${context.journal.path}`);
      return context.journal.state.checkpoints[checkpoint];
    }
  }

  const { actor, txHash } = await submitCall(context, spec, checkpoint, preState);
  const receipt = await pollCheckpointReceipt(
    context,
    checkpoint,
    actor.token,
    txHash,
    deadline
  );
  if (isPendingReceipt(receipt)) {
    const latestStatus = persistReceiptTimeout(context, checkpoint, receipt);
    throw new CheckpointStop(
      checkpoint,
      "timeout",
      txHash,
      "Transaction did not reach a terminal state",
      latestStatus
    );
  }

  if (spec.expectFailure) {
    const postState = await context.capture();
    return confirmExpectedFailure(
      context,
      checkpoint,
      nextCheckpoint,
      spec,
      receipt,
      postState,
      txHash
    );
  }

  if (receipt.status !== "Success") {
    context.journal.updateSubmitted(checkpoint, {
      transactionHash: txHash,
      receipt,
      latestStatus: receipt,
      terminalFailure: true,
    });
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      txHash,
      `${spec.name} failed: ${stableJson(receipt)}`,
      receipt
    );
  }
  context.journal.updateSubmitted(checkpoint, {
    transactionHash: txHash,
    receipt,
    latestStatus: receipt,
  });

  const governed = await reconcileGovernedSubmission(
    context,
    checkpoint,
    spec,
    actor,
    txHash,
    deadline
  );
  let postState;
  let pendingReconciliation;
  const governanceIssueId = governed.issueId;
  const submittedEntry = context.journal.state.checkpoints[checkpoint];
  const expectedNoStateChange = Boolean(
    submittedEntry.expectedPostState &&
    snapshotDiff(preState, submittedEntry.expectedPostState).length === 0
  );
  do {
    postState = await context.capture();
    pendingReconciliation = reconcileFeeAdjustedState(
      preState,
      postState,
      context,
      spec,
      `${spec.name} pending state`
    );
    if (!pendingReconciliation.matched || expectedNoStateChange) break;
    if (Date.now() < deadline) await sleep(Math.min(POLL_INTERVAL_MS, deadline - Date.now()));
  } while (Date.now() < deadline);
  if (pendingReconciliation.matched && !expectedNoStateChange) {
    context.journal.updateSubmitted(checkpoint, {
      latestObservedPostState: postState,
      pendingFeePaymentEvidence: pendingReconciliation.feePaymentEvidence,
    });
    throw new CheckpointStop(
      checkpoint,
      "pending_governance",
      txHash,
      governanceIssueId
        ? `Governance issue ${governanceIssueId} has not activated the expected state`
        : "Receipt succeeded but live economic state still matches saved pre-state",
      {
        receipt,
        latestObservedPostState: postState,
        governanceIssueId,
      }
    );
  }

  const { events, governanceExecution: collectedGovernanceExecution } = await collectCheckpointEvents(
    context,
    checkpoint,
    spec,
    actor,
    receipt,
    txHash,
    governanceIssueId,
    receiptBlock(receipt).timestamp,
    deadline
  );
  const governanceExecution = governed.execution || collectedGovernanceExecution;
  const entry = context.journal.state.checkpoints[checkpoint];
  let economicPostState = entry.economicExpectedPostState || entry.expectedPostState || null;
  if (!economicPostState && typeof spec.reconcileSubmittedPostState === "function") {
    economicPostState = await spec.reconcileSubmittedPostState({
      checkpoint,
      transactionHash: txHash,
      preState,
      observedState: postState,
      receipt,
      events,
      governanceIssueId,
      governanceExecution,
    }, context);
    if (!economicPostState || typeof economicPostState !== "object" ||
        Array.isArray(economicPostState)) {
      throw new Error(`${spec.name} reconcileSubmittedPostState must return a full snapshot object`);
    }
    economicPostState = jsonValue(economicPostState);
  }
  if (!economicPostState) {
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      txHash,
      "Successful submission has no full receipt/event-derived expected post-state",
      receipt
    );
  }
  const reconciliation = reconcileFeeAdjustedState(
    economicPostState,
    postState,
    context,
    spec,
    `${spec.name} post-state`
  );
  context.journal.updateSubmitted(checkpoint, {
    economicExpectedPostState: economicPostState,
    expectedPostState: reconciliation.expectedPostState,
    feePaymentEvidence: reconciliation.feePaymentEvidence,
    receiptEventReconciledAt: new Date().toISOString(),
  });
  if (!reconciliation.matched) {
    throw new CheckpointStop(
      checkpoint,
      governanceIssueId ? "pending_governance" : "unknown_status",
      txHash,
      "Live state does not exactly match the receipt-derived expected post-state",
      { receipt, postStateDifferences: reconciliation.differences }
    );
  }
  const verificationReceipt = governed.executionReceipt || receipt;
  const verificationHash = governed.execution && governed.execution.transactionHash || txHash;
  const assertionResult = {
    receipt: verificationReceipt,
    preState,
    feePaymentEvidence: reconciliation.feePaymentEvidence,
  };
  if (spec.assertPost) spec.assertPost(postState, assertionResult, context);
  assertCheckpointEvents(
    context,
    checkpoint,
    spec,
    events,
    verificationReceipt,
    preState,
    postState,
    verificationHash
  );
  if (spec.afterConfirm) {
    spec.afterConfirm(preState, postState, verificationReceipt, events, context);
  }
  const result = {
    transactionHash: txHash,
    receipt,
    governanceIssueId: governanceExecution ? governanceIssueId : null,
    governanceExecutionTransactionHash:
      governanceExecution && governanceExecution.transactionHash || null,
    confirmedBlock: confirmedBlock(verificationReceipt, events),
    observedEvents: events,
    confirmedPostState: postState,
    expectedPostState: reconciliation.expectedPostState,
    feePaymentEvidence: reconciliation.feePaymentEvidence,
    nextCheckpointId: nextCheckpoint,
    confirmedEvidence: await checkpointEvidence(context, spec, {
      checkpoint,
      phase: "confirmed",
      preState,
      postState,
      receipt: verificationReceipt,
      events,
    }),
  };
  context.journal.confirmed(checkpoint, result);
  trace(checkpoint, "exit", postState, spec.traceFields || []);
  console.log(`CHECKPOINT_CONFIRMED checkpoint=${checkpoint} next=${nextCheckpoint} runState=${context.journal.path}`);
  return result;
}

async function assertResumeState(context, checkpoint, orderedCheckpoints, checkpointSpec) {
  const state = context.journal.state;
  assertEqual(state.scriptHash, context.scriptHash, "script hash");
  assertEqual(state.configHash, context.configHash, "configuration hash");
  assertEqual(state.network.nodeUrl, rootNodeUrl(), "NODE_URL");
  const index = orderedCheckpoints.indexOf(checkpoint);
  if (index < 0) throw new Error(`Unknown checkpoint ${checkpoint}`);
  const earlierIds = orderedCheckpoints.slice(0, index);
  for (const earlier of earlierIds) {
    const entry = state.checkpoints[earlier];
    if (!entry) {
      throw new Error(`Earlier checkpoint ${earlier} is missing from the run-state`);
    }
    if (entry.status !== "confirmed") {
      throw new Error(`Earlier checkpoint ${earlier} is not confirmed`);
    }
    if (!entry.confirmedPostState) {
      throw new Error(`Earlier checkpoint ${earlier} has no full confirmed post-state`);
    }
  }
  for (const later of orderedCheckpoints.slice(index + 1)) {
    if (state.checkpoints[later] && state.checkpoints[later].status === "confirmed") {
      throw new Error(`Later checkpoint ${later} is already confirmed`);
    }
  }
  const currentEntry = state.checkpoints[checkpoint];
  const previous = earlierIds.length
    ? state.checkpoints[earlierIds[earlierIds.length - 1]]
    : null;
  const evidenceAnchor = currentEntry && currentEntry.status === "confirmed"
    ? currentEntry.confirmedEvidence
    : currentEntry && ["prepared", "ready", "dispatching", "submitted"].includes(currentEntry.status)
      ? currentEntry.readyEvidence
      : previous && previous.confirmedEvidence;
  if (evidenceAnchor) {
    const liveEvidence = journalEvidence(context);
    for (const key of ["ghostLedger", "derived"]) {
      if (evidenceAnchor[key] == null) continue;
      const differences = snapshotSubsetDiff(evidenceAnchor[key], liveEvidence[key]);
      if (differences.length) {
        console.error(
          `CHECKPOINT_EVIDENCE_MISMATCH checkpoint=${checkpoint} evidence=${key} ` +
          `differences=${stableJson(differences)}`
        );
        throw new Error(`Saved ${key} evidence does not match the resumable journal state`);
      }
    }
  }
  const current = await context.capture();
  if (currentEntry && ["dispatching", "submitted"].includes(currentEntry.status)) {
    const preDifferences = snapshotDiff(currentEntry.expectedPreState, current);
    if (!preDifferences.length) return;
    if (checkpointSpec && reconcileFeeAdjustedState(
      currentEntry.expectedPreState,
      current,
      context,
      checkpointSpec,
      `${checkpointSpec.name} resumable pending state`
    ).matched) {
      return;
    }
    if (currentEntry.expectedPostState &&
        exactSnapshot(currentEntry.expectedPostState, current)) {
      return;
    }
    if (checkpointSpec && currentEntry.economicExpectedPostState &&
        reconcileFeeAdjustedState(
          currentEntry.economicExpectedPostState,
          current,
          context,
          checkpointSpec,
          `${checkpointSpec.name} resumable post-state`
        ).matched) {
      return;
    }
    if (checkpointSpec &&
        typeof checkpointSpec.reconcileSubmittedPostState === "function") {
      return;
    }
    console.error(
      `CHECKPOINT_STATE_MISMATCH checkpoint=${checkpoint} differences=${stableJson(preDifferences)}`
    );
    const detail = currentEntry.expectedPostState
      ? `fullPostDifferences=${stableJson(snapshotDiff(currentEntry.expectedPostState, current))}`
      : "fullPostDifferences=unavailable";
    throw new CheckpointStop(
      checkpoint,
      "unknown_status",
      currentEntry.transactionHash,
      `Submitted checkpoint matches neither exact saved pre-state nor exact full expected post-state; ${detail}`,
      currentEntry.latestStatus
    );
  }
  const expectedState = currentEntry && currentEntry.status === "confirmed"
    ? currentEntry.confirmedPostState
    : currentEntry && ["prepared", "ready"].includes(currentEntry.status)
      ? currentEntry.expectedPreState
      : previous && previous.confirmedPostState;
  if (!expectedState) return;
  const differences = snapshotDiff(expectedState, current);
  if (differences.length) {
    console.error(`CHECKPOINT_STATE_MISMATCH checkpoint=${checkpoint} differences=${stableJson(differences)}`);
    throw new Error(`Live state does not exactly match the resumable checkpoint state`);
  }
}

function createContext(options) {
  const scriptHash = hashFile(options.scriptPath);
  const configHash = hashValue(options.configuration);
  const journal = new RunJournal(options.runStatePath, {
    script: options.scriptName,
    scriptVersion: 1,
    scriptHash,
    network: { nodeUrl: rootNodeUrl() },
    configHash,
    configuration: jsonValue(options.configuration),
  });
  return {
    ...options,
    scriptHash,
    configHash,
    journal,
    capture() {
      return readVaultSnapshot(this);
    },
  };
}

function approvalMigrationComparable(configuration) {
  const comparable = JSON.parse(stableJson(configuration || {}));
  delete comparable.commonHash;
  delete comparable.operationsHash;
  delete comparable.approverAuthority;
  if (comparable.addresses) delete comparable.addresses.APPROVER;
  return comparable;
}

function migratePendingGovernanceApproval(context) {
  const state = context.journal.state;
  if (state.scriptHash === context.scriptHash && state.configHash === context.configHash) {
    return false;
  }
  const pending = Object.values(state.checkpoints || {}).filter((entry) =>
    entry && entry.status === "submitted" &&
    entry.governanceIssueId &&
    entry.governanceIssueCreatedEvent &&
    entry.accessControl && entry.accessControl.governed === true);
  if (pending.length !== 1 ||
      stableJson(approvalMigrationComparable(state.configuration)) !==
        stableJson(approvalMigrationComparable(context.configuration))) {
    return false;
  }
  state.automaticApprovalMigration = {
    type: "governance-reconciliation-update",
    checkpointId: pending[0].checkpointId,
    previousScriptHash: state.scriptHash,
    previousConfigHash: state.configHash,
    migratedAt: new Date().toISOString(),
  };
  state.scriptHash = context.scriptHash;
  state.configHash = context.configHash;
  state.configuration = jsonValue(context.configuration);
  context.journal.save();
  return true;
}

function migrateSubmittedNoOpReconciliation(context) {
  const state = context.journal.state;
  if (state.scriptHash !== context.scriptHash ||
      state.configHash === context.configHash) {
    return false;
  }
  const pending = Object.values(state.checkpoints || {}).filter((entry) =>
    entry && entry.status === "submitted" &&
    entry.transactionHash &&
    entry.accessControl && entry.accessControl.governed === false &&
    entry.expectedPreState && entry.expectedPostState &&
    snapshotDiff(entry.expectedPreState, entry.expectedPostState).length === 0);
  const latest = state.interruptions && state.interruptions[state.interruptions.length - 1];
  const priorConfiguration = JSON.parse(stableJson(state.configuration || {}));
  const currentConfiguration = JSON.parse(stableJson(context.configuration || {}));
  delete priorConfiguration.commonHash;
  delete currentConfiguration.commonHash;
  if (pending.length !== 1 ||
      !latest || latest.checkpointId !== pending[0].checkpointId ||
      latest.reason !== "pending_governance" ||
      latest.latestStatus && latest.latestStatus.governanceIssueId ||
      stableJson(priorConfiguration) !== stableJson(currentConfiguration)) {
    return false;
  }
  state.noOpReconciliationMigration = {
    type: "successful-no-state-change",
    checkpointId: pending[0].checkpointId,
    previousConfigHash: state.configHash,
    migratedAt: new Date().toISOString(),
  };
  state.configHash = context.configHash;
  state.configuration = jsonValue(context.configuration);
  context.journal.save();
  return true;
}

async function runWithJournal(context, callback) {
  const alreadyHeld = context.journal.lockFd != null;
  if (!alreadyHeld) context.journal.acquire();
  try {
    migratePendingGovernanceApproval(context);
    migrateSubmittedNoOpReconciliation(context);
    context.journal.save();
    return await callback();
  } catch (error) {
    if (error instanceof CheckpointStop) {
      context.journal.interrupt(
        error.checkpoint,
        error.reason,
        error.txHash,
        error.latestStatus
      );
      console.error(
        `CHECKPOINT_STOP checkpoint=${error.checkpoint} runState=${context.journal.path} ` +
        `reason=${error.reason} txHash=${error.txHash}`
      );
    }
    throw error;
  } finally {
    if (!alreadyHeld) context.journal.release();
  }
}

function loadFundingEvidence(manifestPath = process.env.YIELD_VAULT_FUNDING_MANIFEST) {
  if (!manifestPath) return null;
  const absolute = path.resolve(manifestPath);
  return { path: absolute, hash: hashFile(absolute), manifest: readJson(absolute) };
}

module.exports = {
  U,
  RAY,
  MAX_UINT256,
  MAX_RATE,
  ZERO_ADDRESS,
  POLL_LIMIT_MS,
  sleep,
  jsonValue,
  stableJson,
  parseJsonPreservingIntegers,
  cirrusResponseRows,
  hashValue,
  hashFile,
  atomicWrite,
  readJson,
  parseArgs,
  env,
  normalizeAddress,
  bigint,
  boolean,
  field,
  mappingValue,
  authenticateActors,
  readAdminMembership,
  validateStorageOwnerAuthority,
  assertDistinctAddresses,
  latestBlock,
  readTokenBalances,
  readVaultSnapshot,
  assertEqual,
  assertSnapshot,
  eventAttributes,
  eventIdentityKey,
  assertEventValues,
  snapshotDiff,
  snapshotSubsetDiff,
  reconcileFeeAdjustedState,
  actorEconomicDelta,
  remainingCheckpointRequirements,
  trace,
  CheckpointStop,
  executeCheckpoint,
  assertResumeState,
  createContext,
  migratePendingGovernanceApproval,
  migrateSubmittedNoOpReconciliation,
  runWithJournal,
  loadFundingEvidence,
  defaultConfirmSubmissionAbsent,
  readAccountSubmissionState,
  lookupRawSubmission,
  findIssueCreated,
  findIssueExecution,
  governanceEventMatches,
  governanceEventIsAfter,
  sameTransactionHash,
  externalGovernanceExecutionReconciliation,
  reconcileGovernedSubmission,
  approveGovernedSubmission,
  governanceApprovalCall,
  rawLogicalPayload,
  rawPayloadMatches,
  readRawTransaction,
  ADMIN_REGISTRY,
  fetchExpectedTestnetNetwork,
};
