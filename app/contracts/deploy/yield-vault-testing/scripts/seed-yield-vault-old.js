#!/usr/bin/env node

const path = require("path");
const axios = require("axios");
const { rest } = require("blockapps-rest");
const {
  config,
  fetchExpectedTestnetNetwork,
  rootNodeUrl,
} = require("./runtime");
const {
  U,
  MAX_UINT256,
  ZERO_ADDRESS,
  stableJson,
  hashFile,
  atomicWrite,
  readJson,
  parseArgs,
  env,
  normalizeAddress,
  bigint,
  boolean,
  authenticateActors,
  assertDistinctAddresses,
  assertEqual,
  assertSnapshot,
  eventAttributes,
  assertEventValues,
  executeCheckpoint,
  assertResumeState,
  createContext,
  runWithJournal,
  loadFundingEvidence,
  readTokenBalances,
  readVaultSnapshot,
  actorEconomicDelta,
  remainingCheckpointRequirements,
  validateStorageOwnerAuthority,
  readAdminMembership,
  ADMIN_REGISTRY,
} = require("./common");
const { reviewedPolicyForNetwork } = require("./fee-policy");
const { readFeePolicyEvidence } = require("./fund-yield-vault-test-actors");

const SCRIPT_NAME = "seed-yield-vault-old";
const CHECKPOINTS = [
  "001", "002", "100", "110", "111", "112", "120", "121", "122", "123", "124", "125",
  "130", "131", "140", "150", "151", "152", "160", "170",
  "171", "180", "181", "182", "190",
];

const A = {
  ALICE_DEPOSIT: 200n * U,
  BOB_DEPOSIT: 150n * U,
  CAROL_DEPOSIT: 100n * U,
  FIRST_DEPLOY: 300n * U,
  STRATEGY_PROFIT: 20n * U,
  STRATEGY_RETURN: 320n * U,
  SECOND_DEPLOY: 220n * U,
  STRATEGY_LOSS: 20n * U,
  ALICE_REQUEST: 120n * U,
  BOB_REQUEST: 80n * U,
  FIRST_PROCESS_BUDGET: 50n * U,
  MIN_IDLE_BPS: 1000n,
};

const TRACE_FIELDS = [
  "implementation", "paused", "idle", "deployedAssets", "totalAssets", "activeAssets",
  "totalSupply", "totalQueuedShares", "totalClaimableAssets", "exchangeRate",
  "strategyDebt.STRATEGY",
  "shares.ALICE", "shares.BOB", "shares.CAROL", "shares.VAULT_PROXY",
];

const CURRENT_RUN_UNDERLYING = {
  ALICE: A.ALICE_DEPOSIT,
  BOB: A.BOB_DEPOSIT,
  CAROL: A.CAROL_DEPOSIT,
  STRATEGY: 30n * U,
};

const REQUIRED_FEE_ACTORS = [
  "OWNER", "ALICE", "BOB", "CAROL", "STRATEGY",
];
const ONLY_OWNER = Object.freeze({
  onlyOwner: true,
  governed: true,
  registryContract: "YieldVaultOld",
});
const SEED_FUNDING_FLOWS = {
  "120": [{ actor: "ALICE", delta: -A.ALICE_DEPOSIT }],
  "122": [{ actor: "BOB", delta: -A.BOB_DEPOSIT }],
  "124": [{ actor: "CAROL", delta: -A.CAROL_DEPOSIT }],
  "140": [{ actor: "STRATEGY", delta: A.FIRST_DEPLOY }],
  "151": [{ actor: "STRATEGY", delta: -A.STRATEGY_RETURN }],
  "160": [{ actor: "STRATEGY", delta: A.SECOND_DEPLOY }],
  "170": [{ actor: "STRATEGY", delta: -A.STRATEGY_LOSS }],
  "171": [{ actor: "STRATEGY", delta: -(A.SECOND_DEPLOY - A.STRATEGY_LOSS) }],
};

function usage() {
  console.error(
    "Usage: node seed-yield-vault-old.js --run-state <path> [--checkpoint <CHECKPOINT_ID>]"
  );
  console.error("Phase 0 requires the local yield-vault:deploy-old-proxy evidence artifact.");
}

function defaultSeedManifestPath(runStatePath) {
  const absolute = path.resolve(runStatePath);
  if (/-run-state\.json$/i.test(absolute)) {
    return absolute.replace(/-run-state\.json$/i, "-manifest.json");
  }
  return absolute.replace(/\.json$/i, "") + ".manifest.json";
}

function tx(name, actor, contract, contractName, method, args, expected, events = [], access = {}) {
  return {
    name,
    actor,
    contract,
    contractName,
    method,
    args,
    events,
    ...access,
    traceFields: TRACE_FIELDS,
    postRules: Object.entries(expected).map(([key, value]) => `${key} == ${value}`),
    captureExpectedPostState(preState, context) {
      return predictSeedPostState(preState, {
        actor,
        contract,
        method,
        args: typeof args === "function" ? args(preState, context) : args,
      }, context);
    },
    assertPost(snapshot) {
      assertSnapshot(snapshot, expected, name);
      assertCoreIdentities(snapshot);
    },
  };
}

function observed(name, actor, expected, postRules = []) {
  return {
    name,
    actor,
    noTransaction: true,
    traceFields: TRACE_FIELDS,
    postRules,
    assertPost(snapshot) {
      if (typeof expected === "function") expected(snapshot);
      else assertSnapshot(snapshot, expected, name);
      assertCoreIdentities(snapshot);
    },
  };
}

function assertAtLeast(actual, minimum, label) {
  if (bigint(actual) < bigint(minimum)) {
    throw new Error(`${label}: expected at least ${minimum}, observed ${actual}`);
  }
}

function assertCoreIdentities(snapshot) {
  const debt = bigint(snapshot.strategyDebt.STRATEGY);
  assertEqual(snapshot.deployedAssets, debt, "deployed assets equal checked strategy debt");
  assertEqual(
    snapshot.totalAssets,
    bigint(snapshot.idle) + bigint(snapshot.deployedAssets),
    "total assets identity"
  );
  const claims = bigint(snapshot.claimableAssets.ALICE) + bigint(snapshot.claimableAssets.BOB);
  assertEqual(snapshot.totalClaimableAssets, claims, "checked claims identity");
}

function cloneSnapshot(snapshot) {
  return JSON.parse(JSON.stringify(snapshot));
}

function setAmount(object, key, value) {
  object[key] = bigint(value).toString();
}

function addAmount(object, key, delta) {
  setAmount(object, key, bigint(object[key]) + bigint(delta));
}

function subtractAmount(object, key, delta, label) {
  const next = bigint(object[key]) - bigint(delta);
  if (next < 0n) throw new Error(`${label || key} prediction would become negative`);
  setAmount(object, key, next);
}

function roleForAddress(context, address, label) {
  const normalized = normalizeAddress(address, label);
  const match = Object.entries(context.addresses)
    .find(([, candidate]) => candidate === normalized);
  if (!match) throw new Error(`Cannot map ${label} ${normalized} to a captured actor`);
  return match[0];
}

function spendUnderlyingAllowance(snapshot, owner, value) {
  if (bigint(snapshot.allowances[owner]) !== MAX_UINT256) {
    subtractAmount(snapshot.allowances, owner, value, `${owner} underlying allowance`);
  }
}

function rebuildDerivedSnapshot(snapshot) {
  setAmount(snapshot, "idle", snapshot.underlying.VAULT_PROXY);
  setAmount(snapshot, "totalAssets", bigint(snapshot.idle) + bigint(snapshot.deployedAssets));
  const activeAssets = bigint(snapshot.totalAssets) > bigint(snapshot.totalClaimableAssets)
    ? bigint(snapshot.totalAssets) - bigint(snapshot.totalClaimableAssets)
    : 0n;
  setAmount(snapshot, "activeAssets", activeAssets);
  const totalSupply = bigint(snapshot.totalSupply);
  setAmount(
    snapshot,
    "exchangeRate",
    totalSupply === 0n ? U : activeAssets * U / totalSupply
  );
  const freeQueue = bigint(snapshot.idle) > bigint(snapshot.totalClaimableAssets)
    ? bigint(snapshot.idle) - bigint(snapshot.totalClaimableAssets)
    : 0n;
  setAmount(snapshot, "freeIdleForQueueProcessing", freeQueue);
  setAmount(
    snapshot,
    "freeIdleForInstantWithdrawals",
    bigint(snapshot.queueHead) === 0n ? freeQueue : 0n
  );
  const minimumIdle = bigint(snapshot.minIdleBps) === 0n
    ? 0n
    : (activeAssets * bigint(snapshot.minIdleBps) + 9_999n) / 10_000n;
  const maxDeploy = !snapshot.paused && bigint(snapshot.queueHead) === 0n &&
      freeQueue > minimumIdle
    ? freeQueue - minimumIdle
    : 0n;
  setAmount(snapshot, "maxDeploy", maxDeploy);

  const viewFields = [
    "owner", "asset", "vaultInitialized", "totalSupply", "deployedAssets",
    "nextRequestId", "paused", "totalAssets", "activeAssets", "exchangeRate", "maxDeploy",
  ];
  if (snapshot.vaultInitialized) {
    viewFields.push(
      "idle", "freeIdleForInstantWithdrawals", "freeIdleForQueueProcessing"
    );
  }
  snapshot.liveViews = Object.fromEntries(
    viewFields.map((field) => [field, snapshot[field]])
  );
  return snapshot;
}

function predictDeposit(snapshot, operation, context) {
  const assets = bigint(operation.args.assets);
  const supply = bigint(snapshot.totalSupply);
  const activeAssets = bigint(snapshot.activeAssets);
  const shares = supply === 0n
    ? assets
    : activeAssets === 0n
      ? 0n
      : assets * supply / activeAssets;
  if (shares <= 0n) throw new Error("Deposit prediction produced zero shares");
  const receiver = roleForAddress(context, operation.args.receiver, "deposit receiver");
  subtractAmount(snapshot.underlying, operation.actor, assets, "depositor underlying");
  spendUnderlyingAllowance(snapshot, operation.actor, assets);
  addAmount(snapshot.underlying, "VAULT_PROXY", assets);
  addAmount(snapshot.shares, receiver, shares);
  addAmount(snapshot, "totalSupply", shares);
}

function predictRequest(snapshot, operation, context) {
  const shares = bigint(operation.args.shares);
  const owner = roleForAddress(context, operation.args.owner_, "request owner");
  const requestId = bigint(snapshot.nextRequestId);
  const requestKey = requestId.toString();
  if (!Object.prototype.hasOwnProperty.call(snapshot.requests, requestKey)) {
    throw new Error(`Request ${requestKey} is outside the captured request ID set`);
  }
  const previousTail = bigint(snapshot.queueTail);
  snapshot.requests[requestKey] = {
    shares: shares.toString(),
    receiver: normalizeAddress(operation.args.receiver, "request receiver"),
    next: "0",
    exists: true,
  };
  snapshot.requestOwner[requestKey] = normalizeAddress(
    operation.args.owner_,
    "request owner"
  );
  setAmount(snapshot.activeRequestId, owner, requestId);
  addAmount(snapshot, "totalQueuedShares", shares);
  subtractAmount(snapshot.shares, owner, shares, "request owner shares");
  addAmount(snapshot.shares, "VAULT_PROXY", shares);
  if (previousTail === 0n) {
    setAmount(snapshot, "queueHead", requestId);
  } else {
    snapshot.requests[previousTail.toString()].next = requestKey;
  }
  setAmount(snapshot, "queueTail", requestId);
  setAmount(snapshot, "nextRequestId", requestId + 1n);
}

function predictQueueProcessing(snapshot, operation, context) {
  if (bigint(operation.args.maxRequests) !== 1n) {
    throw new Error("Queue checkpoint 182 exact predictor requires maxRequests=1");
  }
  const requestKey = bigint(snapshot.queueHead).toString();
  const request = snapshot.requests[requestKey];
  if (!request || !request.exists || bigint(request.shares) === 0n) {
    throw new Error("Queue prediction requires a non-empty queue head");
  }
  const owner = roleForAddress(
    context,
    snapshot.requestOwner[requestKey],
    "queue request owner"
  );
  const available = bigint(operation.args.maxAssets) <
      bigint(snapshot.freeIdleForQueueProcessing)
    ? bigint(operation.args.maxAssets)
    : bigint(snapshot.freeIdleForQueueProcessing);
  const supply = bigint(snapshot.totalSupply);
  const activeAssets = bigint(snapshot.activeAssets);
  if (supply === 0n || activeAssets === 0n) {
    throw new Error("Queue checkpoint 182 prediction requires positive active supply and assets");
  }
  const pendingAssets = bigint(request.shares) * activeAssets / supply;
  if (pendingAssets <= available) {
    throw new Error(
      "Queue checkpoint 182 exact predictor only supports its specified partial-head branch"
    );
  }
  const sharesProcessed = (available * supply + activeAssets - 1n) / activeAssets;
  const assetsReserved = sharesProcessed * activeAssets / supply;
  if (sharesProcessed <= 0n || sharesProcessed > bigint(request.shares) ||
      assetsReserved <= 0n || assetsReserved > available) {
    throw new Error("Queue checkpoint 182 prediction does not satisfy contract bounds");
  }
  subtractAmount(request, "shares", sharesProcessed, "queue request shares");
  subtractAmount(snapshot, "totalQueuedShares", sharesProcessed, "total queued shares");
  subtractAmount(snapshot.shares, "VAULT_PROXY", sharesProcessed, "vault queued shares");
  subtractAmount(snapshot, "totalSupply", sharesProcessed, "total supply");
  addAmount(snapshot.claimableAssets, owner, assetsReserved);
  addAmount(snapshot, "totalClaimableAssets", assetsReserved);
}

function predictSeedPostState(preState, operation, context) {
  const snapshot = cloneSnapshot(preState);
  const args = operation.args || {};
  const key = `${operation.contract}.${operation.method}`;
  switch (key) {
    case "ASSET.approve":
      setAmount(snapshot.allowances, operation.actor, args.value);
      break;
    case "ASSET.transfer": {
      const receiver = roleForAddress(context, args.to, "asset transfer receiver");
      subtractAmount(snapshot.underlying, operation.actor, args.value, "asset sender balance");
      addAmount(snapshot.underlying, receiver, args.value);
      break;
    }
    case "VAULT_PROXY.initialize":
      snapshot.asset = normalizeAddress(args.asset_, "initialized asset");
      snapshot.name = String(args.name_);
      snapshot.symbol = String(args.symbol_);
      snapshot.vaultInitialized = true;
      setAmount(snapshot, "minIdleBps", 0n);
      setAmount(snapshot, "nextRequestId", 1n);
      break;
    case "VAULT_PROXY.deposit":
      predictDeposit(snapshot, operation, context);
      break;
    case "VAULT_PROXY.setMinIdleBps":
      setAmount(snapshot, "minIdleBps", args.minIdleBps_);
      break;
    case "VAULT_PROXY.setStrategyApproval": {
      const strategy = roleForAddress(context, args.strategy, "approved strategy");
      snapshot.approvedStrategies[strategy] = Boolean(args.approved);
      break;
    }
    case "VAULT_PROXY.deployCapital": {
      const strategy = roleForAddress(context, args.to, "capital recipient");
      addAmount(snapshot.strategyDebt, strategy, args.assets);
      addAmount(snapshot, "deployedAssets", args.assets);
      subtractAmount(snapshot.underlying, "VAULT_PROXY", args.assets, "vault underlying");
      addAmount(snapshot.underlying, strategy, args.assets);
      break;
    }
    case "VAULT_PROXY.returnCapital": {
      const strategy = roleForAddress(context, args.from, "capital source");
      const assets = bigint(args.assets);
      const principal = assets < bigint(snapshot.strategyDebt[strategy])
        ? assets
        : bigint(snapshot.strategyDebt[strategy]);
      subtractAmount(snapshot.underlying, strategy, assets, "strategy underlying");
      addAmount(snapshot.underlying, "VAULT_PROXY", assets);
      spendUnderlyingAllowance(snapshot, strategy, assets);
      subtractAmount(snapshot.strategyDebt, strategy, principal, "strategy debt");
      subtractAmount(snapshot, "deployedAssets", principal, "deployed assets");
      break;
    }
    case "VAULT_PROXY.reportStrategyLoss": {
      const strategy = roleForAddress(context, args.strategy, "loss strategy");
      subtractAmount(snapshot.strategyDebt, strategy, args.loss, "strategy debt");
      subtractAmount(snapshot, "deployedAssets", args.loss, "deployed assets");
      break;
    }
    case "VAULT_PROXY.requestRedeem":
      predictRequest(snapshot, operation, context);
      break;
    case "VAULT_PROXY.processQueue":
      predictQueueProcessing(snapshot, operation, context);
      break;
    default:
      throw new Error(`No exact expected-post-state predictor for ${key}`);
  }
  return rebuildDerivedSnapshot(snapshot);
}

function fundingField(manifest, paths) {
  for (const candidate of paths) {
    const value = candidate.split(".").reduce((current, key) => current && current[key], manifest);
    if (value != null) return value;
  }
  return null;
}

function requireFundingMapEntry(map, actor, label) {
  if (!map || typeof map !== "object" ||
      !Object.prototype.hasOwnProperty.call(map, actor)) {
    throw new Error(`Funding manifest ${label} is missing ${actor}`);
  }
  return bigint(map[actor], `${label}.${actor}`);
}

function validateFundingManifest(fundingEvidence, addresses, networkIdentity) {
  if (!fundingEvidence) {
    throw new Error("YIELD_VAULT_FUNDING_MANIFEST is required for a new seed run");
  }
  const manifest = fundingEvidence.manifest;
  if (manifest.schemaVersion !== 2) {
    throw new Error("Funding manifest schemaVersion must be 2");
  }
  if (manifest.completed !== true ||
      manifest.allPlannedMintsConfirmed !== true ||
      manifest.allFinalAssertionsConfirmed !== true) {
    throw new Error(
      "Funding manifest must set completed, allPlannedMintsConfirmed, and " +
      "allFinalAssertionsConfirmed to true"
    );
  }
  if (!Array.isArray(manifest.mintPlan) || !Array.isArray(manifest.transactions) ||
      manifest.transactions.length !== manifest.mintPlan.length ||
      manifest.transactions.length === 0) {
    throw new Error("Funding manifest transaction count must exactly match its non-empty mint plan");
  }
  for (const [index, transaction] of manifest.transactions.entries()) {
    const confirmedHash = transaction && transaction.receipt && (
      transaction.receipt.hash || transaction.receipt.transactionHash ||
      transaction.receipt.transaction_hash || transaction.receipt.txHash
    );
    if (!transaction || !transaction.transactionHash ||
        !transaction.receipt || transaction.receipt.status !== "Success" ||
        String(confirmedHash || "").replace(/^0x/, "").toLowerCase() !==
          String(transaction.transactionHash).replace(/^0x/, "").toLowerCase()) {
      throw new Error(`Funding manifest transaction ${index + 1} is not confirmed successful`);
    }
  }

  const runs = bigint(fundingField(manifest, ["runs", "requestedRuns", "configuration.runs"]) || 0);
  if (runs < 10n) throw new Error(`Funding manifest covers only ${runs} runs; at least 10 are required`);
  const asset = fundingField(manifest, ["addresses.ASSET", "tokens.asset.address"]);
  assertEqual(normalizeAddress(asset, "funding asset"), addresses.ASSET, "funding asset");
  const feeToken = normalizeAddress(manifest.addresses && manifest.addresses.FEE_TOKEN, "funding fee token");
  assertEqual(feeToken, normalizeAddress(env("FEE_TOKEN_ADDRESS")), "funding fee token");
  assertEqual(String(manifest.network && manifest.network.nodeUrl).replace(/\/+$/, ""), rootNodeUrl(),
    "funding network URL");
  assertEqual(String(manifest.network && manifest.network.networkID), networkIdentity.networkID,
    "funding network ID");
  assertEqual(String(manifest.network && manifest.network.networkName), networkIdentity.networkName,
    "funding network name");
  const manifestActors = manifest.actors || {};
  for (const actor of ["OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK"]) {
    if (!manifestActors[actor]) throw new Error(`Funding manifest is missing actor ${actor}`);
    assertEqual(
      normalizeAddress(manifestActors[actor], `funding ${actor}`),
      addresses[actor],
      `funding ${actor}`
    );
  }
  if (manifestActors.STRATEGY_A !== undefined || manifestActors.STRATEGY_B !== undefined) {
    throw new Error("Funding manifest must use singular STRATEGY");
  }

  const underlyingTargets = manifest.budgets && manifest.budgets.computedUnderlyingByRole;
  const feeTargets = manifest.budgets && manifest.budgets.computedFeeByRole;
  const finalBalances = manifest.final && manifest.final.balances;
  const verifiedUnderlying = {};
  for (const [actor, currentRunMinimum] of Object.entries(CURRENT_RUN_UNDERLYING)) {
    const target = requireFundingMapEntry(underlyingTargets, actor, "underlying target");
    const balanceKey = `${addresses.ASSET}:${addresses[actor]}`;
    if (!finalBalances || finalBalances[balanceKey] == null) {
      throw new Error(`Funding manifest final underlying balance is missing ${actor}`);
    }
    const finalBalance = bigint(
      finalBalances[balanceKey],
      `final underlying balance ${actor}`
    );
    assertAtLeast(target, currentRunMinimum, `${actor} funding target`);
    assertAtLeast(finalBalance, target, `${actor} funding final balance`);
    verifiedUnderlying[actor] = {
      currentRunMinimum: currentRunMinimum.toString(),
      target: target.toString(),
      finalBalance: finalBalance.toString(),
    };
  }

  const verifiedFee = {};
  for (const actor of REQUIRED_FEE_ACTORS) {
    const target = requireFundingMapEntry(feeTargets, actor, "fee target");
    const balanceKey = `${feeToken}:${addresses[actor]}`;
    if (!finalBalances || finalBalances[balanceKey] == null) {
      throw new Error(`Funding manifest final fee balance is missing ${actor}`);
    }
    const finalBalance = bigint(
      finalBalances[balanceKey],
      `final fee balance ${actor}`
    );
    assertAtLeast(finalBalance, target, `${actor} funding final fee balance`);
    verifiedFee[actor] = {
      target: target.toString(),
      finalBalance: finalBalance.toString(),
    };
    if (feeToken === addresses.ASSET && underlyingTargets[actor] != null) {
      assertAtLeast(
        finalBalance,
        target + bigint(underlyingTargets[actor]),
        `${actor} combined funding final balance`
      );
    }
  }

  return {
    runs: runs.toString(),
    completed: true,
    allPlannedMintsConfirmed: true,
    allFinalAssertionsConfirmed: true,
    feeToken,
    transactionFeeWei: bigint(manifest.network.transactionFeeWei, "funding transaction fee").toString(),
    verifiedUnderlying,
    verifiedFee,
  };
}

async function authenticatedGet(url, tokenObj, params) {
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${tokenObj.token}`, Accept: "application/json" },
    params,
  });
  return response.data;
}

async function fetchNetworkIdentity(tokenObj, get = authenticatedGet) {
  return fetchExpectedTestnetNetwork(tokenObj, async () =>
    get(`${rootNodeUrl()}/strato-api/eth/v1.2/metadata`, tokenObj)
  );
}

function unwrapViewScalar(value, label) {
  let current = value;
  for (let depth = 0; depth < 8; depth++) {
    if (Array.isArray(current)) {
      if (current.length !== 1) {
        throw new Error(`${label} returned ${current.length} values; expected one`);
      }
      current = current[0];
      continue;
    }
    if (current && typeof current === "object") {
      const key = ["contents", "result", "value", "v", "data", "response"]
        .find((candidate) => current[candidate] != null);
      if (!key) throw new Error(`${label} returned an unsupported object: ${stableJson(current)}`);
      current = current[key];
      continue;
    }
    if (current == null) throw new Error(`${label} returned no value`);
    return current;
  }
  throw new Error(`${label} response nesting is unsupported: ${stableJson(value)}`);
}

async function readRequiredVaultViews(context, readSnapshot = readVaultSnapshot) {
  const snapshot = await readSnapshot(context);
  const views = {
    owner: snapshot.owner,
    asset: snapshot.asset,
    vaultInitialized: snapshot.vaultInitialized,
    totalSupply: snapshot.totalSupply,
    deployedAssets: snapshot.deployedAssets,
    nextRequestId: snapshot.nextRequestId,
    paused: snapshot.paused,
    totalAssets: snapshot.totalAssets,
    activeAssets: snapshot.activeAssets,
    exchangeRate: snapshot.exchangeRate,
    maxDeploy: snapshot.maxDeploy,
    source: "bloc-state",
  };
  if (views.vaultInitialized) {
    views.idle = snapshot.idle;
    views.freeIdleForInstantWithdrawals = snapshot.freeIdleForInstantWithdrawals;
    views.freeIdleForQueueProcessing = snapshot.freeIdleForQueueProcessing;
  }
  return views;
}

async function captureVerifiedSnapshot(context, captureState, readViews = readRequiredVaultViews) {
  const snapshot = await captureState();
  const liveViews = await readViews(context);
  for (const [field, value] of Object.entries(liveViews)) {
    if (field === "source") continue;
    assertEqual(snapshot[field], value, `${field} state/view agreement`);
  }
  return { ...snapshot, liveViews };
}

function requiredEvidenceFile(name) {
  const configured = env(name);
  const filePath = path.resolve(configured);
  return { path: filePath, hash: hashFile(filePath), value: readJson(filePath) };
}

function receiptHash(receipt) {
  const value = receipt && (
    receipt.hash || receipt.transactionHash || receipt.transaction_hash ||
    receipt.txHash || receipt.txResult && receipt.txResult.transactionHash
  );
  const normalized = String(value || "").replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Deployment evidence receipt is missing a transaction hash");
  }
  return normalized;
}

function receiptCreatedAddress(receipt, label) {
  const values = [
    receipt && receipt.txResult && receipt.txResult.contractsCreated,
    receipt && receipt.contractsCreated,
    receipt && receipt.txResult && receipt.txResult.response,
    receipt && receipt.data && receipt.data.contents,
  ];
  const queue = [...values];
  while (queue.length) {
    const candidate = queue.shift();
    if (candidate && typeof candidate === "object") {
      queue.push(...(Array.isArray(candidate) ? candidate : Object.values(candidate)));
      continue;
    }
    try {
      return normalizeAddress(candidate, label);
    } catch (_) {
      // Continue through supported blockapps-rest response shapes.
    }
  }
  throw new Error(`${label} is missing from the receipt`);
}

function validateEvidenceSource(entry, expectedHash, label) {
  if (!entry || entry.matched !== true ||
      String(entry.combinedSourceHash).toLowerCase() !== String(expectedHash).toLowerCase() ||
      String(entry.expectedReviewedSourceHash).toLowerCase() !==
        String(expectedHash).toLowerCase()) {
    throw new Error(`${label} does not prove the exact reviewed combined-source hash`);
  }
}

function readExternalDeploymentEvidence(addresses, networkIdentity) {
  const file = requiredEvidenceFile("OLD_PROXY_EVIDENCE_PATH");
  const deployment = file.value;
  if (deployment.schemaVersion !== 2 ||
      deployment.type !== "yield-vault-old-proxy-deployment" ||
      deployment.completed !== true) {
    throw new Error("Local old-proxy deployment evidence is incomplete or unsupported");
  }
  assertEqual(
    String(deployment.network && deployment.network.networkID),
    networkIdentity.networkID,
    "old-proxy evidence network ID"
  );
  assertEqual(
    String(deployment.network && deployment.network.networkName),
    networkIdentity.networkName,
    "old-proxy evidence network name"
  );
  assertEqual(
    String(deployment.network && deployment.network.nodeUrl).replace(/\/+$/, ""),
    rootNodeUrl(),
    "old-proxy evidence node URL"
  );
  validateEvidenceSource(
    deployment.source && deployment.source.proxy,
    env("EXPECTED_PROXY_SOURCE_HASH"),
    "Proxy source evidence"
  );
  validateEvidenceSource(
    deployment.source && deployment.source.oldImplementation,
    env("EXPECTED_OLD_REVIEWED_SOURCE_HASH"),
    "YieldVaultOld source evidence"
  );
  assertEqual(
    normalizeAddress(deployment.expectedStorageOwner || deployment.owner),
    addresses.VAULT_OWNER,
    "old-proxy evidence storage owner"
  );
  assertEqual(
    normalizeAddress(deployment.operatorSigner),
    addresses.OWNER,
    "old-proxy evidence operator signer"
  );
  assertEqual(
    normalizeAddress(deployment.deploymentSigner),
    addresses.DEPLOYER,
    "old-proxy evidence deployment signer"
  );
  if (addresses.DEPLOYER === addresses.OWNER) {
    throw new Error("Old-proxy evidence DEPLOYER and OWNER signers must be distinct");
  }
  const proxyOperation = deployment.operations && deployment.operations["deploy-proxy"];
  const implementationOperation = deployment.operations &&
    deployment.operations["deploy-old-implementation"];
  const activationOperation = deployment.operations &&
    deployment.operations["activate-old-implementation"];
  if (!deployment.signers || !deployment.signers.DEPLOYER ||
      deployment.signers.DEPLOYER.role !== "DEPLOYER" ||
      normalizeAddress(deployment.signers.DEPLOYER.address) !== addresses.DEPLOYER ||
      !deployment.signers.OWNER || deployment.signers.OWNER.role !== "OWNER" ||
      normalizeAddress(deployment.signers.OWNER.address) !== addresses.OWNER ||
      !proxyOperation || proxyOperation.signer.role !== "DEPLOYER" ||
      normalizeAddress(proxyOperation.signer.address) !== addresses.DEPLOYER ||
      !implementationOperation || implementationOperation.signer.role !== "DEPLOYER" ||
      normalizeAddress(implementationOperation.signer.address) !== addresses.DEPLOYER ||
      !activationOperation || activationOperation.signer.role !== "OWNER" ||
      normalizeAddress(activationOperation.signer.address) !== addresses.OWNER) {
    throw new Error("Old-proxy evidence does not preserve complete DEPLOYER/OWNER registry");
  }
  assertEqual(normalizeAddress(deployment.proxy.address), addresses.VAULT_PROXY,
    "old-proxy evidence proxy");
  assertEqual(normalizeAddress(deployment.implementation.address), addresses.OLD_IMPLEMENTATION,
    "old-proxy evidence implementation");
  assertEqual(
    receiptCreatedAddress(deployment.proxy.creationReceipt, "Proxy receipt-created address"),
    addresses.VAULT_PROXY,
    "Proxy receipt-created address"
  );
  assertEqual(
    receiptCreatedAddress(
      deployment.implementation.creationReceipt,
      "YieldVaultOld receipt-created address"
    ),
    addresses.OLD_IMPLEMENTATION,
    "YieldVaultOld receipt-created address"
  );
  if (!deployment.activation || !deployment.activation.activationReceipt ||
      normalizeAddress(deployment.activation.proxyAddress) !== addresses.VAULT_PROXY ||
      normalizeAddress(deployment.activation.confirmedImplementation) !==
        addresses.OLD_IMPLEMENTATION) {
    throw new Error("Old implementation activation evidence is incomplete");
  }
  const evidence = {
    proxyDeploymentTransactionHash: receiptHash(deployment.proxy.creationReceipt),
    oldImplementationDeploymentTransactionHash:
      receiptHash(deployment.implementation.creationReceipt),
    oldImplementationActivationTransactionHash:
      receiptHash(deployment.activation.activationReceipt),
    governanceIssueId:
      deployment.activation.governance && deployment.activation.governance.issueId || null,
    proxy: addresses.VAULT_PROXY,
    activeImplementation: addresses.OLD_IMPLEMENTATION,
    deploymentPerformedBySeedScript: false,
    source: deployment.source,
    structuredEvidenceFiles: {
      localOldProxyDeployment: { path: file.path, hash: file.hash },
    },
  };
  const hashes = Object.entries(evidence)
    .filter(([key]) => key.endsWith("TransactionHash"))
    .map(([, value]) => value);
  if (new Set(hashes).size !== hashes.length) {
    throw new Error("Deployment and activation transaction hashes must be distinct");
  }
  return evidence;
}

async function validateExternalDeploymentEvidence(tokens, evidence) {
  const receipts = {};
  for (const [name, hash] of Object.entries(evidence)) {
    if (!name.endsWith("TransactionHash") || !hash) continue;
    const tokenObj = name === "oldImplementationActivationTransactionHash"
      ? tokens.OWNER
      : tokens.DEPLOYER;
    const results = await rest.getBlocResults(tokenObj, [hash], { config, isAsync: true });
    const receipt = Array.isArray(results) ? results[0] : results;
    if (!receipt) throw new Error(`${name} ${hash} has no STRATO receipt`);
    if (receipt.status !== "Success") {
      throw new Error(
        `${name} ${hash} is not successful: ${stableJson(receipt.status || receipt)}`
      );
    }
    if (name === "proxyDeploymentTransactionHash") {
      assertEqual(
        receiptCreatedAddress(receipt, "live Proxy receipt-created address"),
        evidence.proxy,
        "live Proxy receipt-created address"
      );
    }
    if (name === "oldImplementationDeploymentTransactionHash") {
      assertEqual(
        receiptCreatedAddress(receipt, "live YieldVaultOld receipt-created address"),
        evidence.activeImplementation,
        "live YieldVaultOld receipt-created address"
      );
    }
    receipts[name] = receipt;
  }
  return { ...evidence, validatedReceipts: receipts };
}

function recordPhase0Evidence(context, checkpoint, snapshot) {
  const entry = context.journal.state.checkpoints[checkpoint];
  if (!entry || entry.status !== "confirmed") {
    throw new Error(`Cannot record Phase 0 evidence before checkpoint ${checkpoint} is confirmed`);
  }
  entry.externalDeploymentEvidence = checkpoint === "001"
    ? {
        proxy: context.addresses.VAULT_PROXY,
        proxyOwner: snapshot.proxyOwner,
        proxyDeploymentTransactionHash:
          context.externalDeploymentEvidence.proxyDeploymentTransactionHash,
        proxyDeploymentReceipt:
          context.externalDeploymentEvidence.validatedReceipts.proxyDeploymentTransactionHash ||
          null,
        deploymentPerformedBySeedScript: false,
      }
    : {
        proxy: context.addresses.VAULT_PROXY,
        activeImplementation: snapshot.implementation,
        expectedImplementation: context.addresses.OLD_IMPLEMENTATION,
        oldImplementationDeploymentTransactionHash:
          context.externalDeploymentEvidence.oldImplementationDeploymentTransactionHash,
        oldImplementationActivationTransactionHash:
          context.externalDeploymentEvidence.oldImplementationActivationTransactionHash,
        oldImplementationDeploymentReceipt:
          context.externalDeploymentEvidence.validatedReceipts
            .oldImplementationDeploymentTransactionHash || null,
        oldImplementationActivationReceipt:
          context.externalDeploymentEvidence.validatedReceipts
            .oldImplementationActivationTransactionHash || null,
        governanceIssueId: context.externalDeploymentEvidence.governanceIssueId,
        deploymentPerformedBySeedScript: false,
      };
  context.journal.save();
}

function receiptReturnValues(receipt) {
  const candidates = [
    receipt && receipt.data && receipt.data.contents,
    receipt && receipt.txResult && receipt.txResult.response,
    receipt && receipt.response,
  ];
  for (let candidate of candidates) {
    if (typeof candidate === "string" && /^[\[{]/.test(candidate.trim())) {
      try {
        candidate = JSON.parse(candidate);
      } catch (_) {
        continue;
      }
    }
    for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth++) {
      if (!Array.isArray(candidate) &&
          ["processedRequests", "burnedShares", "reservedAssets"]
            .every((key) => candidate[key] != null)) {
        return [
          bigint(candidate.processedRequests, "processQueue processedRequests"),
          bigint(candidate.burnedShares, "processQueue burnedShares"),
          bigint(candidate.reservedAssets, "processQueue reservedAssets"),
        ];
      }
      if (Array.isArray(candidate)) {
        if (candidate.length >= 3) {
          try {
            return candidate.slice(0, 3).map((value, index) =>
              bigint(value, `processQueue return ${index}`)
            );
          } catch (_) {
            break;
          }
        }
        if (candidate.length === 1) {
          candidate = candidate[0];
          continue;
        }
        break;
      }
      const key = ["v", "contents", "result", "value", "data", "response"]
        .find((name) => candidate[name] != null);
      if (!key) break;
      candidate = candidate[key];
    }
  }
  return null;
}

function processQueueEvidence(receipt, events, preState, postState) {
  const returned = receiptReturnValues(receipt);
  const expected = [1n, A.FIRST_PROCESS_BUDGET, A.FIRST_PROCESS_BUDGET];
  if (returned) {
    assertEqual(returned[0], expected[0], "processQueue processedRequests return");
    assertEqual(returned[1], expected[1], "processQueue burnedShares return");
    assertEqual(returned[2], expected[2], "processQueue reservedAssets return");
    return {
      mode: "receipt-return",
      processedRequests: returned[0].toString(),
      burnedShares: returned[1].toString(),
      reservedAssets: returned[2].toString(),
    };
  }

  const queueEvents = events.filter((event) => event.eventName === "QueueProcessed");
  assertEqual(queueEvents.length, 1, "processQueue QueueProcessed event count");
  const attributes = eventAttributes(queueEvents[0]);
  assertEqual(
    bigint(attributes.requestId, "QueueProcessed.requestId"),
    1n,
    "processQueue request ID"
  );
  assertEqual(
    bigint(attributes.sharesBurned, "QueueProcessed.sharesBurned"),
    A.FIRST_PROCESS_BUDGET,
    "processQueue event burned shares"
  );
  assertEqual(
    bigint(attributes.assetsReserved, "QueueProcessed.assetsReserved"),
    A.FIRST_PROCESS_BUDGET,
    "processQueue event reserved assets"
  );
  assertEqual(boolean(attributes.fullyProcessed), false, "processQueue partial event");
  assertEqual(
    bigint(preState.requests["1"].shares) - bigint(postState.requests["1"].shares),
    A.FIRST_PROCESS_BUDGET,
    "processQueue request 1 share delta"
  );
  assertEqual(
    bigint(preState.totalQueuedShares) - bigint(postState.totalQueuedShares),
    A.FIRST_PROCESS_BUDGET,
    "processQueue total queued share delta"
  );
  assertEqual(
    bigint(preState.totalSupply) - bigint(postState.totalSupply),
    A.FIRST_PROCESS_BUDGET,
    "processQueue burned share state delta"
  );
  assertEqual(
    bigint(postState.claimableAssets.ALICE) - bigint(preState.claimableAssets.ALICE),
    A.FIRST_PROCESS_BUDGET,
    "processQueue reserved asset state delta"
  );
  assertEqual(postState.requests["2"].shares, preState.requests["2"].shares, "request 2 unchanged");
  return {
    mode: "state-event-delta",
    processedRequests: "1",
    queueProcessedEventCount: "1",
    requestId: bigint(attributes.requestId, "QueueProcessed.requestId").toString(),
    burnedShares: A.FIRST_PROCESS_BUDGET.toString(),
    reservedAssets: A.FIRST_PROCESS_BUDGET.toString(),
  };
}

function assertSeedFinal(snapshot, addresses) {
  assertSnapshot(snapshot, {
    implementation: addresses.OLD_IMPLEMENTATION,
    asset: addresses.ASSET,
    paused: false,
    vaultInitialized: true,
    idle: 250n * U,
    deployedAssets: 200n * U,
    totalAssets: 450n * U,
    activeAssets: 400n * U,
    totalSupply: 400n * U,
    exchangeRate: U,
    freeIdleForInstantWithdrawals: 0n,
    freeIdleForQueueProcessing: 200n * U,
    maxDeploy: 0n,
    minIdleBps: 1000n,
    nextRequestId: 3n,
    queueHead: 1n,
    queueTail: 2n,
    totalQueuedShares: 150n * U,
    totalClaimableAssets: 50n * U,
    "strategyDebt.STRATEGY": 200n * U,
    "approvedStrategies.STRATEGY": true,
    "shares.ALICE": 80n * U,
    "shares.BOB": 70n * U,
    "shares.CAROL": 100n * U,
    "shares.VAULT_PROXY": 150n * U,
    "activeRequestId.ALICE": 1n,
    "activeRequestId.BOB": 2n,
    "claimableAssets.ALICE": 50n * U,
    "claimableAssets.BOB": 0n,
    "requests.1.shares": 70n * U,
    "requests.1.receiver": addresses.ALICE,
    "requests.1.next": 2n,
    "requests.1.exists": true,
    "requests.2.shares": 80n * U,
    "requests.2.receiver": addresses.BOB,
    "requests.2.next": 0n,
    "requests.2.exists": true,
    "requestOwner.1": addresses.ALICE,
    "requestOwner.2": addresses.BOB,
  }, "final seed state");
  assertCoreIdentities(snapshot);
  assertEqual(
    snapshot.totalQueuedShares,
    bigint(snapshot.requests["1"].shares) + bigint(snapshot.requests["2"].shares),
    "queued shares identity"
  );
  assertEqual(
    snapshot.totalSupply,
    bigint(snapshot.shares.ALICE) + bigint(snapshot.shares.BOB) +
      bigint(snapshot.shares.CAROL) + bigint(snapshot.shares.VAULT_PROXY),
    "share supply identity"
  );
  assertEqual(
    snapshot.activeAssets,
    bigint(snapshot.totalAssets) - bigint(snapshot.totalClaimableAssets),
    "active assets identity"
  );
  assertEqual(snapshot.freeIdleForQueueProcessing, 200n * U, "free idle for queue processing");
}

function assertStrategyStartsEmpty(snapshot) {
  assertEqual(snapshot.strategyDebt.STRATEGY, 0n, "initial STRATEGY debt");
  assertEqual(snapshot.allowances.STRATEGY, 0n, "initial STRATEGY allowance");
  assertEqual(snapshot.approvedStrategies.STRATEGY, false, "initial STRATEGY approval");
}

function buildCheckpointSpecs(context) {
  const { addresses } = context;
  return {
    "001": observed(
      "validate externally deployed proxy",
      "OWNER",
      (snapshot) => {
        assertEqual(snapshot.proxyOwner, addresses.VAULT_OWNER, "proxy owner");
        assertEqual(snapshot.owner, addresses.VAULT_OWNER, "vault owner");
        assertStrategyStartsEmpty(snapshot);
      },
      [
        "VAULT_PROXY exists and owner is OWNER",
        "STRATEGY starts with zero debt, allowance, and approval",
      ]
    ),
    "002": observed(
      "validate active YieldVaultOld implementation",
      "OWNER",
      (snapshot) => {
        assertEqual(snapshot.implementation, addresses.OLD_IMPLEMENTATION, "old implementation");
        assertEqual(snapshot.proxyOwner, addresses.VAULT_OWNER, "proxy owner");
        assertEqual(snapshot.owner, addresses.VAULT_OWNER, "vault owner");
      },
      ["Proxy.logicContract == OLD_IMPLEMENTATION"]
    ),
    "110": {
      ...observed("fund ALICE", "ALICE", {}, [
        "funding target/final evidence verified; live ALICE underlying >= 200 U",
      ]),
      assertPost(snapshot) {
        assertAtLeast(snapshot.underlying.ALICE, A.ALICE_DEPOSIT, "ALICE underlying");
        assertAtLeast(
          context.fundingValidation.verifiedUnderlying.ALICE.target,
          A.ALICE_DEPOSIT,
          "ALICE manifest target"
        );
        assertCoreIdentities(snapshot);
      },
    },
    "111": {
      ...observed("fund BOB", "BOB", {}, [
        "funding target/final evidence verified; live BOB underlying >= 150 U",
      ]),
      assertPost(snapshot) {
        assertAtLeast(snapshot.underlying.BOB, A.BOB_DEPOSIT, "BOB underlying");
        assertAtLeast(
          context.fundingValidation.verifiedUnderlying.BOB.target,
          A.BOB_DEPOSIT,
          "BOB manifest target"
        );
        assertCoreIdentities(snapshot);
      },
    },
    "112": {
      ...observed("fund CAROL", "CAROL", {}, [
        "funding target/final evidence verified; live CAROL underlying >= 100 U",
      ]),
      assertPost(snapshot) {
        assertAtLeast(snapshot.underlying.CAROL, A.CAROL_DEPOSIT, "CAROL underlying");
        assertAtLeast(
          context.fundingValidation.verifiedUnderlying.CAROL.target,
          A.CAROL_DEPOSIT,
          "CAROL manifest target"
        );
        assertCoreIdentities(snapshot);
      },
    },
    "120": tx(
      "ALICE asset approval", "ALICE", "ASSET", context.assetContractName, "approve",
      { spender: addresses.VAULT_PROXY, value: MAX_UINT256 },
      { "allowances.ALICE": MAX_UINT256 },
      ["Approval"]
    ),
    "121": tx(
      "ALICE deposit", "ALICE", "VAULT_PROXY", "YieldVault", "deposit",
      { assets: A.ALICE_DEPOSIT, receiver: addresses.ALICE },
      {
        "shares.ALICE": 200n * U,
        totalSupply: 200n * U,
        idle: 200n * U,
        totalAssets: 200n * U,
        exchangeRate: U,
      },
      ["Deposit", "Transfer"]
    ),
    "122": tx(
      "BOB asset approval", "BOB", "ASSET", context.assetContractName, "approve",
      { spender: addresses.VAULT_PROXY, value: MAX_UINT256 },
      { "allowances.BOB": MAX_UINT256 },
      ["Approval"]
    ),
    "123": tx(
      "BOB deposit", "BOB", "VAULT_PROXY", "YieldVault", "deposit",
      { assets: A.BOB_DEPOSIT, receiver: addresses.BOB },
      {
        "shares.ALICE": 200n * U,
        "shares.BOB": 150n * U,
        totalSupply: 350n * U,
        idle: 350n * U,
        totalAssets: 350n * U,
        exchangeRate: U,
      },
      ["Deposit", "Transfer"]
    ),
    "124": tx(
      "CAROL asset approval", "CAROL", "ASSET", context.assetContractName, "approve",
      { spender: addresses.VAULT_PROXY, value: MAX_UINT256 },
      { "allowances.CAROL": MAX_UINT256 },
      ["Approval"]
    ),
    "125": tx(
      "CAROL deposit", "CAROL", "VAULT_PROXY", "YieldVault", "deposit",
      { assets: A.CAROL_DEPOSIT, receiver: addresses.CAROL },
      {
        "shares.ALICE": 200n * U,
        "shares.BOB": 150n * U,
        "shares.CAROL": 100n * U,
        totalSupply: 450n * U,
        idle: 450n * U,
        deployedAssets: 0n,
        totalAssets: 450n * U,
        exchangeRate: U,
      },
      ["Deposit", "Transfer"]
    ),
    "130": tx(
      "set minimum idle basis points", "OWNER", "VAULT_PROXY", "YieldVault", "setMinIdleBps",
      { minIdleBps_: A.MIN_IDLE_BPS },
      { minIdleBps: A.MIN_IDLE_BPS },
      ["MinIdleBpsUpdated"],
      ONLY_OWNER
    ),
    "131": tx(
      "approve STRATEGY", "OWNER", "VAULT_PROXY", "YieldVault", "setStrategyApproval",
      { strategy: addresses.STRATEGY, approved: true },
      { "approvedStrategies.STRATEGY": true },
      ["StrategyApprovalUpdated"],
      ONLY_OWNER
    ),
    "140": {
      ...tx(
        "first deployment to STRATEGY", "OWNER", "VAULT_PROXY", "YieldVault", "deployCapital",
        { to: addresses.STRATEGY, assets: A.FIRST_DEPLOY },
        {
          idle: 150n * U,
          "strategyDebt.STRATEGY": 300n * U,
          deployedAssets: 300n * U,
          totalAssets: 450n * U,
        },
        ["CapitalDeployed"],
        ONLY_OWNER
      ),
      assertPost(snapshot, receipt, ctx) {
        assertSnapshot(snapshot, {
          idle: 150n * U,
          "strategyDebt.STRATEGY": 300n * U,
          deployedAssets: 300n * U,
          totalAssets: 450n * U,
        }, "first strategy deployment");
        const before = bigint(receipt.preState.underlying.STRATEGY);
        assertEqual(snapshot.underlying.STRATEGY, before + A.FIRST_DEPLOY, "strategy balance delta");
        assertCoreIdentities(snapshot);
      },
    },
    "150": {
      ...observed("verify STRATEGY profit budget", "STRATEGY", {}, ["STRATEGY underlying >= 320 U"]),
      assertPost(snapshot) {
        assertAtLeast(snapshot.underlying.STRATEGY, A.STRATEGY_RETURN, "strategy funded balance");
        assertAtLeast(
          context.fundingValidation.verifiedUnderlying.STRATEGY.target,
          CURRENT_RUN_UNDERLYING.STRATEGY,
          "STRATEGY manifest target"
        );
        assertCoreIdentities(snapshot);
      },
    },
    "151": tx(
      "STRATEGY asset approval", "STRATEGY", "ASSET", context.assetContractName, "approve",
      { spender: addresses.VAULT_PROXY, value: A.STRATEGY_RETURN },
      { "allowances.STRATEGY": A.STRATEGY_RETURN },
      ["Approval"]
    ),
    "152": {
      ...tx(
        "return STRATEGY principal and profit", "OWNER", "VAULT_PROXY", "YieldVault", "returnCapital",
        { from: addresses.STRATEGY, assets: A.STRATEGY_RETURN },
        {
          "strategyDebt.STRATEGY": 0n,
          deployedAssets: 0n,
          idle: 470n * U,
          totalAssets: 470n * U,
          totalSupply: 450n * U,
        },
        ["CapitalReturned"],
        ONLY_OWNER
      ),
      assertEvents(events) {
        assertEventValues(events, "CapitalReturned", {
          assetsReturned: A.STRATEGY_RETURN,
          principalRepaid: A.FIRST_DEPLOY,
          realizedProfit: A.STRATEGY_PROFIT,
          strategyDebt: 0n,
          totalDeployed: 0n,
        });
      },
    },
    "160": tx(
      "second deployment to STRATEGY", "OWNER", "VAULT_PROXY", "YieldVault", "deployCapital",
      { to: addresses.STRATEGY, assets: A.SECOND_DEPLOY },
      {
        idle: 250n * U,
        "strategyDebt.STRATEGY": 220n * U,
        deployedAssets: 220n * U,
        totalAssets: 470n * U,
      },
      ["CapitalDeployed"],
      ONLY_OWNER
    ),
    "170": {
      ...tx(
        "transfer STRATEGY loss to LOSS_SINK", "STRATEGY", "ASSET",
        context.assetContractName, "transfer",
        { to: addresses.LOSS_SINK, value: A.STRATEGY_LOSS },
        {},
        ["Transfer"]
      ),
      assertPost(snapshot, receipt) {
        assertEqual(
          actorEconomicDelta(receipt, snapshot, "STRATEGY"),
          -A.STRATEGY_LOSS,
          "STRATEGY physical loss"
        );
        assertEqual(
          bigint(snapshot.underlying.LOSS_SINK) - bigint(receipt.preState.underlying.LOSS_SINK),
          A.STRATEGY_LOSS,
          "LOSS_SINK exact loss receipt"
        );
        assertCoreIdentities(snapshot);
      },
    },
    "171": tx(
      "report STRATEGY loss", "OWNER", "VAULT_PROXY", "YieldVault", "reportStrategyLoss",
      { strategy: addresses.STRATEGY, loss: A.STRATEGY_LOSS },
      {
        idle: 250n * U,
        "strategyDebt.STRATEGY": 200n * U,
        deployedAssets: 200n * U,
        totalAssets: 450n * U,
        totalSupply: 450n * U,
        exchangeRate: U,
      },
      ["StrategyLossReported"],
      ONLY_OWNER
    ),
    "180": tx(
      "create ALICE request", "ALICE", "VAULT_PROXY", "YieldVault", "requestRedeem",
      { shares: A.ALICE_REQUEST, receiver: addresses.ALICE, owner_: addresses.ALICE },
      {
        queueHead: 1n,
        queueTail: 1n,
        nextRequestId: 2n,
        totalQueuedShares: 120n * U,
        "activeRequestId.ALICE": 1n,
        "shares.ALICE": 80n * U,
        "shares.VAULT_PROXY": 120n * U,
        "requests.1.shares": 120n * U,
        "requests.1.receiver": addresses.ALICE,
        "requests.1.exists": true,
      },
      ["WithdrawalRequested", "Transfer"]
    ),
    "181": tx(
      "create BOB request", "BOB", "VAULT_PROXY", "YieldVault", "requestRedeem",
      { shares: A.BOB_REQUEST, receiver: addresses.BOB, owner_: addresses.BOB },
      {
        queueHead: 1n,
        queueTail: 2n,
        nextRequestId: 3n,
        totalQueuedShares: 200n * U,
        totalSupply: 450n * U,
        "activeRequestId.ALICE": 1n,
        "activeRequestId.BOB": 2n,
        "shares.BOB": 70n * U,
        "shares.VAULT_PROXY": 200n * U,
        "requests.1.next": 2n,
        "requests.2.shares": 80n * U,
        "requests.2.receiver": addresses.BOB,
        "requests.2.exists": true,
      },
      ["WithdrawalRequested", "Transfer"]
    ),
    "182": {
      ...tx(
        "partially process queue head", "OWNER", "VAULT_PROXY", "YieldVault", "processQueue",
        { maxRequests: 1n, maxAssets: A.FIRST_PROCESS_BUDGET },
        {
          queueHead: 1n,
          queueTail: 2n,
          nextRequestId: 3n,
          totalQueuedShares: 150n * U,
          totalSupply: 400n * U,
          "shares.VAULT_PROXY": 150n * U,
          "requests.1.shares": 70n * U,
          "requests.1.next": 2n,
          "requests.1.exists": true,
          "requests.2.shares": 80n * U,
          "claimableAssets.ALICE": 50n * U,
          totalClaimableAssets: 50n * U,
          idle: 250n * U,
          activeAssets: 400n * U,
          exchangeRate: U,
        },
        ["QueueProcessed"],
        ONLY_OWNER
      ),
      assertEvents(events, receipt, preState, postState) {
        assertEventValues(events, "QueueProcessed", {
          requestId: 1n,
          sharesBurned: A.FIRST_PROCESS_BUDGET,
          assetsReserved: A.FIRST_PROCESS_BUDGET,
          fullyProcessed: false,
        });
        processQueueEvidence(receipt, events, preState, postState);
      },
    },
    "190": {
      ...observed("assert final seed state and write handoff manifest", "OWNER", {}, [
        "all Phase 6 values and accounting identities hold",
      ]),
      assertPost(snapshot) {
        assertSeedFinal(snapshot, addresses);
      },
    },
  };
}

function buildInitializeSpec(context, live) {
  const { addresses } = context;
  if (live.vaultInitialized) {
    return {
      ...observed("validate initialized empty old proxy", "OWNER", {
        implementation: addresses.OLD_IMPLEMENTATION,
        asset: addresses.ASSET,
        vaultInitialized: true,
        totalAssets: 0n,
        totalSupply: 0n,
        deployedAssets: 0n,
        nextRequestId: 1n,
        paused: false,
      }),
    };
  }
  return tx(
    "initialize empty old proxy", "OWNER", "VAULT_PROXY", "YieldVault", "initialize",
    {
      asset_: addresses.ASSET,
      name_: "Testnet Legacy Yield Vault",
      symbol_: "tLEGACY-YV",
    },
    {
      implementation: addresses.OLD_IMPLEMENTATION,
      asset: addresses.ASSET,
      vaultInitialized: true,
      totalAssets: 0n,
      totalSupply: 0n,
      deployedAssets: 0n,
      nextRequestId: 1n,
      paused: false,
    },
    ["VaultInitialized"],
    ONLY_OWNER
  );
}

function selectInitializeSpec(context, live) {
  return context.journal.state.checkpoints["100"]
    ? buildInitializeSpec(context, { vaultInitialized: false })
    : buildInitializeSpec(context, live);
}

async function writeManifest(context, outputPath) {
  const snapshot = await context.capture();
  assertSeedFinal(snapshot, context.addresses);
  const checkpoint = context.journal.state.checkpoints["190"];
  if (!checkpoint || checkpoint.status !== "confirmed") {
    throw new Error("Cannot write seed manifest before checkpoint 190 is confirmed");
  }
  const block = await require("./common").latestBlock(context.actors.OWNER.token);
  const queueCheckpoint = context.journal.state.checkpoints["182"];
  const queueEvidence = processQueueEvidence(
    queueCheckpoint.receipt,
    queueCheckpoint.observedEvents || [],
    queueCheckpoint.expectedPreState,
    queueCheckpoint.confirmedPostState
  );
  const transactions = Object.values(context.journal.state.checkpoints)
    .filter((entry) => entry.transactionHash)
    .map((entry) => ({
      checkpointId: entry.checkpointId,
      operation: entry.operation,
      transactionHash: entry.transactionHash,
      receipt: entry.receipt,
      events: entry.observedEvents || [],
    }));
  const manifest = {
    schemaVersion: 1,
    type: "yield-vault-old-seed",
    createdAt: new Date().toISOString(),
    network: {
      ...context.networkIdentity,
      nodeUrl: rootNodeUrl(),
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
    },
    actors: Object.fromEntries(
      Object.entries(context.addresses).filter(([name]) =>
        ["OWNER", "ALICE", "BOB", "CAROL", "STRATEGY", "LOSS_SINK"].includes(name)
      )
    ),
    addresses: {
      ASSET: context.addresses.ASSET,
      OLD_IMPLEMENTATION: context.addresses.OLD_IMPLEMENTATION,
      VAULT_PROXY: context.addresses.VAULT_PROXY,
      VAULT_OWNER: context.addresses.VAULT_OWNER,
    },
    ownerAuthority: context.ownerAuthority,
    assetDecimals: snapshot.decimals,
    U: U.toString(),
    expectedNextRequestId: "3",
    expectedGrossEconomicAssets: (450n * U).toString(),
    expectedActiveAssets: (400n * U).toString(),
    expectedExchangeRate: U.toString(),
    finalUnpausedSeedSnapshot: snapshot,
    finalSnapshotBlock: { number: block.number, timestamp: block.timestamp },
    transactions,
    processQueueEvidence: queueEvidence,
    externalDeployment: context.externalDeploymentEvidence,
    phase0CheckpointEvidence: {
      "001": context.journal.state.checkpoints["001"].externalDeploymentEvidence,
      "002": context.journal.state.checkpoints["002"].externalDeploymentEvidence,
    },
    fundingEvidence: context.fundingEvidence
      ? {
          path: context.fundingEvidence.path,
          hash: context.fundingEvidence.hash,
          requestedRuns: context.fundingRequestedRuns,
          completed: context.fundingValidation.completed,
          allPlannedMintsConfirmed: context.fundingValidation.allPlannedMintsConfirmed,
          allFinalAssertionsConfirmed: context.fundingValidation.allFinalAssertionsConfirmed,
          verifiedUnderlying: context.fundingValidation.verifiedUnderlying,
          verifiedFee: context.fundingValidation.verifiedFee,
          liveChecks: context.journal.state.liveFundingChecks,
        }
      : null,
    fundingManifestHash: context.fundingEvidence && context.fundingEvidence.hash,
    fundingRequestedRuns: context.fundingRequestedRuns,
    runState: {
      path: context.journal.path,
      schemaVersion: context.journal.state.schemaVersion,
      scriptHash: context.scriptHash,
      configHash: context.configHash,
      checkpoints: context.journal.state.checkpoints,
      interruptions: context.journal.state.interruptions,
    },
    checkpoint190Complete: true,
  };
  atomicWrite(outputPath, manifest);
  return manifest;
}

async function assertCheckpointState(checkpoint, context, specs) {
  return assertResumeState(context, checkpoint, CHECKPOINTS, specs[checkpoint]);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), ["run-state"]);
  } catch (error) {
    usage();
    throw error;
  }
  if (args.help) {
    usage();
    return;
  }
  if (args["deploy-old-proxy"]) {
    throw new Error(
      "Run npm run yield-vault:deploy-old-proxy separately and provide OLD_PROXY_EVIDENCE_PATH"
    );
  }

  for (const required of ["NODE_URL", "OAUTH_URL", "OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET"]) {
    env(required);
  }
  const actors = await authenticateActors([
    "OWNER", "APPROVER", "DEPLOYER", "ALICE", "BOB", "CAROL", "STRATEGY",
  ]);
  const addresses = {
    ...Object.fromEntries(Object.entries(actors).map(([name, actor]) => [name, actor.address])),
    VAULT_OWNER: normalizeAddress(env("VAULT_OWNER_ADDRESS"), "VAULT_OWNER_ADDRESS"),
    LOSS_SINK: normalizeAddress(env("LOSS_SINK_ADDRESS"), "LOSS_SINK_ADDRESS"),
    ASSET: normalizeAddress(env("ASSET_ADDRESS"), "ASSET_ADDRESS"),
    OLD_IMPLEMENTATION: normalizeAddress(env("OLD_IMPLEMENTATION"), "OLD_IMPLEMENTATION"),
    VAULT_PROXY: normalizeAddress(env("VAULT_PROXY"), "VAULT_PROXY"),
  };
  if (process.env.REWARD_DISTRIBUTOR_ADDRESS &&
      process.env.REWARD_DISTRIBUTOR_ADDRESS.trim()) {
    addresses.REWARD_DISTRIBUTOR = normalizeAddress(
      process.env.REWARD_DISTRIBUTOR_ADDRESS,
      "REWARD_DISTRIBUTOR_ADDRESS"
    );
  }
  assertDistinctAddresses({
    OWNER: addresses.OWNER,
    ALICE: addresses.ALICE,
    BOB: addresses.BOB,
    CAROL: addresses.CAROL,
    STRATEGY: addresses.STRATEGY,
    LOSS_SINK: addresses.LOSS_SINK,
    VAULT_PROXY: addresses.VAULT_PROXY,
  });
  if (addresses.REWARD_DISTRIBUTOR) {
    assertDistinctAddresses({
      STRATEGY: addresses.STRATEGY,
      VAULT_PROXY: addresses.VAULT_PROXY,
      REWARD_DISTRIBUTOR: addresses.REWARD_DISTRIBUTOR,
    });
  }

  const networkIdentity = await fetchNetworkIdentity(actors.OWNER.token);
  const ownerAuthority = await validateStorageOwnerAuthority(
    actors.OWNER,
    addresses.VAULT_OWNER
  );
  const approverAuthority = await validateStorageOwnerAuthority(
    actors.APPROVER,
    ADMIN_REGISTRY
  );
  if (actors.APPROVER.address === actors.OWNER.address) {
    throw new Error("APPROVER must differ from OWNER");
  }
  const deployerAuthority = addresses.VAULT_OWNER === ADMIN_REGISTRY
    ? await validateStorageOwnerAuthority(actors.DEPLOYER, ADMIN_REGISTRY)
    : null;
  const externalDeploymentEvidence = await validateExternalDeploymentEvidence(
    { OWNER: actors.OWNER.token, DEPLOYER: actors.DEPLOYER.token },
    readExternalDeploymentEvidence(addresses, networkIdentity)
  );
  const fundingEvidence = loadFundingEvidence();
  const fundingValidation = validateFundingManifest(fundingEvidence, addresses, networkIdentity);
  let minterAdminMembership = null;
  const fundingAuthorities = fundingEvidence.manifest.authorities || {};
  if (Object.values(fundingAuthorities).some((authority) =>
    authority && authority.mode === "admin-registry")) {
    minterAdminMembership = await readAdminMembership(
      actors.OWNER.token,
      normalizeAddress(fundingEvidence.manifest.actors.MINTER, "funding MINTER"),
      ADMIN_REGISTRY
    );
    if (minterAdminMembership <= 0n) {
      throw new Error("Funding MINTER is no longer a live AdminRegistry admin");
    }
  }
  const feePolicy = reviewedPolicyForNetwork(networkIdentity.networkID);
  assertEqual(fundingValidation.feeToken, feePolicy.feeToken, "reviewed fee token");
  assertEqual(fundingValidation.transactionFeeWei, feePolicy.feeWei, "reviewed transaction fee");
  const liveFeePolicyEvidence = await readFeePolicyEvidence(
    actors.OWNER.token,
    networkIdentity.networkID,
    fundingValidation.feeToken
  );
  const assetContractName = process.env.ASSET_CONTRACT_NAME || "Token";
  const context = createContext({
    scriptName: SCRIPT_NAME,
    scriptPath: __filename,
    runStatePath: args["run-state"],
    actors,
    addresses,
    ownerAuthority,
    approverAuthority,
    minterAdminMembership: minterAdminMembership == null
      ? null
      : minterAdminMembership.toString(),
    registryScope: "seed",
    assetContractName,
    requestIds: [1, 2],
    fundingEvidence,
    fundingRequestedRuns: fundingValidation.runs,
    fundingValidation,
    feePolicy: {
      ...feePolicy,
      feeToken: liveFeePolicyEvidence.verifiedFeeToken,
      feeWei: liveFeePolicyEvidence.verifiedFeeWei,
      liveEvidence: liveFeePolicyEvidence,
    },
    networkIdentity,
    externalDeploymentEvidence,
    configuration: {
      addresses,
      ownerAuthority,
      approverAuthority,
      deployerAuthority,
      assetContractName,
      networkIdentity,
      externalDeploymentEvidence,
      constants: Object.fromEntries(Object.entries(A).map(([key, value]) => [key, value.toString()])),
      commonHash: hashFile(path.join(__dirname, "common.js")),
      fundingManifestHash: fundingEvidence && fundingEvidence.hash,
      fundingRequestedRuns: fundingValidation.runs,
      fundingValidation,
      feePolicy,
    },
  });
  const captureState = context.capture.bind(context);
  context.capture = () => captureVerifiedSnapshot(context, captureState);

  await runWithJournal(context, async () => {
    context.journal.state.liveFeePolicyEvidence = liveFeePolicyEvidence;
    const confirmed = Object.entries(context.journal.state.checkpoints)
      .filter(([, entry]) => entry.status === "confirmed")
      .map(([id]) => id);
    const firstUnconfirmed = CHECKPOINTS.find((id) => !confirmed.includes(id));
    if (!args.checkpoint && confirmed.length && firstUnconfirmed) {
      throw new Error(
        `Unfinished run exists; resume with --checkpoint ${firstUnconfirmed}`
      );
    }
    const start = args.checkpoint || firstUnconfirmed || "190";
    const specs = buildCheckpointSpecs(context);
    specs["100"] = buildInitializeSpec(context, { vaultInitialized: false });
    if (args.checkpoint) {
      await assertCheckpointState(start, context, specs);
    }
    if (firstUnconfirmed) {
      const freshRun = Object.keys(context.journal.state.checkpoints).length === 0;
      const fundingSnapshot = await context.capture();
      const freshRequirements = remainingCheckpointRequirements(
        CHECKPOINTS,
        CHECKPOINTS[0],
        specs,
        { checkpoints: {} },
        SEED_FUNDING_FLOWS
      );
      const remaining = freshRun
        ? {
            underlying: CURRENT_RUN_UNDERLYING,
            calls: freshRequirements.calls,
            included: [...CHECKPOINTS],
          }
        : remainingCheckpointRequirements(
            CHECKPOINTS,
            start,
            specs,
            context.journal.state,
            SEED_FUNDING_FLOWS,
            fundingSnapshot,
            context
          );
      const feeBalances = await readTokenBalances(
        actors.OWNER.token,
        fundingValidation.feeToken,
        Object.fromEntries(REQUIRED_FEE_ACTORS.map((name) => [name, addresses[name]])),
        assetContractName
      );
      const liveFundingChecks = {
        checkedAt: new Date().toISOString(),
        mode: freshRun ? "fresh-full-budget" : "resume-remaining-checkpoints",
        startCheckpoint: start,
        includedCheckpoints: remaining.included,
        asset: addresses.ASSET,
        feeToken: fundingValidation.feeToken,
        underlying: {},
        fees: {},
      };
      for (const actor of REQUIRED_FEE_ACTORS) {
        const required = remaining.underlying[actor] || 0n;
        if (required > 0n) {
          assertAtLeast(fundingSnapshot.underlying[actor], required, `${actor} live underlying`);
        }
        liveFundingChecks.underlying[actor] = {
          required: required.toString(),
          observed: fundingSnapshot.underlying[actor],
        };
        const feeRequired =
          (remaining.calls[actor] || 0n) * bigint(fundingValidation.transactionFeeWei);
        const combinedRequired = fundingValidation.feeToken === addresses.ASSET
          ? feeRequired + required
          : feeRequired;
        assertAtLeast(feeBalances[actor], combinedRequired, `${actor} live fee-token balance`);
        liveFundingChecks.fees[actor] = {
          calls: (remaining.calls[actor] || 0n).toString(),
          required: feeRequired.toString(),
          combinedWithUnderlyingRequired: combinedRequired.toString(),
          observed: feeBalances[actor],
        };
      }
      context.journal.state.liveFundingChecks = liveFundingChecks;
      context.journal.save();
    } else {
      context.journal.state.liveFundingChecks = {
        checkedAt: new Date().toISOString(),
        mode: "completed-final-state-only",
        startCheckpoint: start,
        underlying: {},
        fees: {},
      };
      context.journal.save();
    }

    const initial = await context.capture();
    assertEqual(initial.implementation, addresses.OLD_IMPLEMENTATION, "old implementation");
    assertEqual(initial.proxyOwner, addresses.VAULT_OWNER, "proxy owner");
    assertEqual(initial.owner, addresses.VAULT_OWNER, "vault owner");
    assertEqual(initial.decimals, "18", "asset decimals");

    specs["100"] = selectInitializeSpec(context, initial);
    const startIndex = CHECKPOINTS.indexOf(start);
    if (startIndex < 0) throw new Error(`Unknown checkpoint ${start}`);
    for (let index = startIndex; index < CHECKPOINTS.length; index++) {
      const checkpoint = CHECKPOINTS[index];
      const next = CHECKPOINTS[index + 1] || "DONE";
      await executeCheckpoint(context, checkpoint, next, specs[checkpoint]);
      if (checkpoint === "001" || checkpoint === "002") {
        recordPhase0Evidence(
          context,
          checkpoint,
          context.journal.state.checkpoints[checkpoint].confirmedPostState
        );
      }
    }

    const manifestPath = process.env.SEED_MANIFEST_PATH ||
      defaultSeedManifestPath(args["run-state"]);
    await writeManifest(context, manifestPath);
    console.log(`SEED_MANIFEST path=${path.resolve(manifestPath)}`);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${SCRIPT_NAME} failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  CHECKPOINTS,
  main,
  assertSeedFinal,
  assertCoreIdentities,
  assertStrategyStartsEmpty,
  validateFundingManifest,
  fetchNetworkIdentity,
  readRequiredVaultViews,
  captureVerifiedSnapshot,
  receiptReturnValues,
  processQueueEvidence,
  predictSeedPostState,
  defaultSeedManifestPath,
  readExternalDeploymentEvidence,
  buildCheckpointSpecs,
  buildInitializeSpec,
  selectInitializeSpec,
};
