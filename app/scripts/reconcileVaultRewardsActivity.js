/*
  Script: reconcileVaultRewardsActivity.js
  Purpose: Reconcile a YieldVault Position activity on the Rewards contract whose
           event-derived positions have drifted because QueueProcessed events were
           never counted as withdrawals (and Withdraw events were attributed to
           `receiver` instead of `owner`).

           The reconciliation resets every tracked position with synthetic Withdraw
           actions (settling previously earned rewards without deleting them),
           registers QueueProcessed as an actionable Withdraw event, marks all
           historical unprocessed vault events as processed (so no cursor replay can
           double-apply them), and re-seeds every current holder's stake from their
           carryETH balance + unprocessed queued shares.

  Requirements: Node >= 18 (global fetch). No external dependencies.

  Environment:
    NETWORK           testnet or prod (required)
    NODE_URL          optional profile override
    ADMIN_TOKEN       optional OAuth bearer token
    STRATO_USERNAME, STRATO_PASSWORD, OAUTH_CLIENT_ID,
    OAUTH_CLIENT_SECRET, OPENID_DISCOVERY_URL
                      alternative credentials used to obtain an OAuth token
    REWARDS_ADDRESS, VAULT_ADDRESS, ACTIVITY_ID
                      optional profile overrides
    SNAPSHOT_FILE     Where snapshot state is stored
                      (default ./reconcile-activity-<ACTIVITY_ID>.snapshot.json)
    EVENT_INDEX_BASE  First synthetic eventIndex (default 1000000)
    BATCH_SIZE        Actions per batchHandleAction tx (default 50, capped by
                      the contract's maxBatchSize)
    INSECURE_TLS=1    Disable TLS verification (equivalent of curl -k)

  Usage:
    node reconcileVaultRewardsActivity.js <phase> --network <testnet|prod>
      [--execute] [--confirm-prod] [--batch <number>]
      [--allow-unpaused]

  Phases (in operational order):
    status           Show current drift (per-user stake vs balance+queued)
    pause            Pause the YieldVault
    snapshot         Snapshot stakes/balances/queue, reserve + verify synthetic
                     (blockNumber, eventIndex) pairs, write SNAPSHOT_FILE
    withdraw         Vote on one synthetic Withdraw batch -> totalStake 0
    set-events       setPositionActivityEvents: Deposit->Deposit,
                     Withdraw->Withdraw, QueueProcessed->Withdraw
                     (requires totalStake == 0)
    mark-historical  Vote on one zero-amount historical marker batch
    seed             Vote on one synthetic Deposit batch
    verify           Final invariant check + report
    unpause          Unpause the YieldVault
    set-emission     setEmissionRate(ACTIVITY_ID, <rate>)  e.g.
                     node ... set-emission 38580246913580250 --execute

  Every mutating phase is a dry run unless --execute is passed.
*/

"use strict";

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

if (process.env.INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const args = process.argv.slice(2);
const phase = args[0];
const optionValue = (name) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const NETWORK_PROFILES = {
  testnet: {
    nodeUrl: "https://node1.testnet.strato.nexus",
    rewards: "170147f58738c9f46112a874030420b823901f3b",
    vault: "ac8ce8b3d4aa4b9a359dad3bb792a563f7f2e2f5",
    activityId: "22",
  },
  prod: {
    nodeUrl: "https://app.strato.nexus",
    rewards: "4a116cf8cb056036632aef08f7c0df27c720f1c0",
    vault: "a94905d8bd117e9bfbe57aadffd7abbea760e028",
    activityId: "27",
  },
};

const NETWORK = String(optionValue("--network") || process.env.NETWORK || "").toLowerCase();
const PROFILE = NETWORK_PROFILES[NETWORK];
const NODE_URL = (process.env.NODE_URL || PROFILE?.nodeUrl || "").replace(/\/+$/, "");
let adminToken = process.env.ADMIN_TOKEN || "";
const REWARDS = (process.env.REWARDS_ADDRESS || PROFILE?.rewards || "").toLowerCase().replace(/^0x/, "");
const VAULT = (process.env.VAULT_ADDRESS || PROFILE?.vault || "").toLowerCase().replace(/^0x/, "");
const ACTIVITY_ID = process.env.ACTIVITY_ID || PROFILE?.activityId;
const ADMIN_REGISTRY = (process.env.ADMIN_REGISTRY_ADDRESS || "000000000000000000000000000000000000100c")
  .toLowerCase()
  .replace(/^0x/, "");
const EVENT_INDEX_BASE = Number(process.env.EVENT_INDEX_BASE || 1000000);
const SEED_INDEX_OFFSET = 100000; // seed pairs live at EVENT_INDEX_BASE + SEED_INDEX_OFFSET + i
const BATCH_SIZE_ENV = Number(process.env.BATCH_SIZE || 50);
const SNAPSHOT_FILE =
  process.env.SNAPSHOT_FILE || `./reconcile-${NETWORK}-activity-${ACTIVITY_ID}.snapshot.json`;

const GAS = { gasLimit: 32100000000, gasPrice: 1 }; // same as rewards-poller
const TX_POLL_INTERVAL_MS = 5000;
const TX_POLL_TIMEOUT_MS = 600000;
const CIRRUS_POLL_INTERVAL_MS = 3000;
const CIRRUS_POLL_TIMEOUT_MS = 180000;

const ZERO40 = "0000000000000000000000000000000000000000";

const EXECUTE = args.includes("--execute");
const CONFIRM_PROD = args.includes("--confirm-prod");
const ALLOW_UNPAUSED = args.includes("--allow-unpaused");
const BATCH_NUMBER = Number(optionValue("--batch") || 1);

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chain integers arrive as decimal strings, "" (empty = zero) or the 20-byte
// zero sentinel "000...0". BigInt handles all three ("" -> 0n).
const chainUint = (v) => {
  if (v === null || v === undefined || v === "") return 0n;
  return BigInt(String(v));
};

const fmt18 = (v) => {
  const n = BigInt(v);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const die = (msg) => {
  console.error(`\nFATAL: ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Keccak-256 + RLP: replicates SolidVM's keccak256(blockNumber, eventIndex),
// which is hex(keccak256(rlp([blockNumber, eventIndex]))). Verified against
// live processedEvents rows on testnet.
// ---------------------------------------------------------------------------

function keccak256(bytes) {
  const RC = [
    [0x00000000, 0x00000001], [0x00000000, 0x00008082], [0x80000000, 0x0000808a], [0x80000000, 0x80008000],
    [0x00000000, 0x0000808b], [0x00000000, 0x80000001], [0x80000000, 0x80008081], [0x80000000, 0x00008009],
    [0x00000000, 0x0000008a], [0x00000000, 0x00000088], [0x00000000, 0x80008009], [0x00000000, 0x8000000a],
    [0x00000000, 0x8000808b], [0x80000000, 0x0000008b], [0x80000000, 0x00008089], [0x80000000, 0x00008003],
    [0x80000000, 0x00008002], [0x80000000, 0x00000080], [0x00000000, 0x0000800a], [0x80000000, 0x8000000a],
    [0x80000000, 0x80008081], [0x80000000, 0x00008080], [0x00000000, 0x80000001], [0x80000000, 0x80008008],
  ];
  const RHO = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
  const s = Array.from({ length: 25 }, () => [0, 0]);
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] |= 0x01;
  padded[padded.length - 1] |= 0x80;

  const rotl = (x, n) => {
    const [hi, lo] = x;
    n %= 64;
    if (n === 0) return [hi | 0, lo | 0];
    if (n < 32) return [((hi << n) | (lo >>> (32 - n))) | 0, ((lo << n) | (hi >>> (32 - n))) | 0];
    if (n === 32) return [lo | 0, hi | 0];
    n -= 32;
    return [((lo << n) | (hi >>> (32 - n))) | 0, ((hi << n) | (lo >>> (32 - n))) | 0];
  };

  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const o = off + i * 8;
      s[i][1] ^= padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24);
      s[i][0] ^= padded[o + 4] | (padded[o + 5] << 8) | (padded[o + 6] << 16) | (padded[o + 7] << 24);
    }
    for (let round = 0; round < 24; round++) {
      const C = [];
      for (let x = 0; x < 5; x++) {
        C[x] = [
          s[x][0] ^ s[x + 5][0] ^ s[x + 10][0] ^ s[x + 15][0] ^ s[x + 20][0],
          s[x][1] ^ s[x + 5][1] ^ s[x + 10][1] ^ s[x + 15][1] ^ s[x + 20][1],
        ];
      }
      for (let x = 0; x < 5; x++) {
        const r = rotl(C[(x + 1) % 5], 1);
        const D = [C[(x + 4) % 5][0] ^ r[0], C[(x + 4) % 5][1] ^ r[1]];
        for (let y = 0; y < 5; y++) {
          s[x + 5 * y][0] ^= D[0];
          s[x + 5 * y][1] ^= D[1];
        }
      }
      const B = Array.from({ length: 25 }, () => [0, 0]);
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], RHO[x + 5 * y]);
        }
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          const i = x + 5 * y;
          s[i] = [
            B[i][0] ^ (~B[((x + 1) % 5) + 5 * y][0] & B[((x + 2) % 5) + 5 * y][0]),
            B[i][1] ^ (~B[((x + 1) % 5) + 5 * y][1] & B[((x + 2) % 5) + 5 * y][1]),
          ];
        }
      }
      s[0][0] ^= RC[round][0];
      s[0][1] ^= RC[round][1];
    }
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    const [hi, lo] = s[i];
    const o = i * 8;
    out[o] = lo & 0xff; out[o + 1] = (lo >>> 8) & 0xff; out[o + 2] = (lo >>> 16) & 0xff; out[o + 3] = (lo >>> 24) & 0xff;
    out[o + 4] = hi & 0xff; out[o + 5] = (hi >>> 8) & 0xff; out[o + 6] = (hi >>> 16) & 0xff; out[o + 7] = (hi >>> 24) & 0xff;
  }
  return out;
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function rlpUint(n) {
  n = BigInt(n);
  if (n === 0n) return [0x80];
  const bytes = [];
  for (let v = n; v > 0n; v >>= 8n) bytes.unshift(Number(v & 0xffn));
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return [0x80 + bytes.length, ...bytes];
}

function eventHash(blockNumber, eventIndex) {
  const payload = [...rlpUint(blockNumber), ...rlpUint(eventIndex)];
  if (payload.length > 55) throw new Error("RLP payload unexpectedly long");
  return toHex(keccak256(Uint8Array.from([0xc0 + payload.length, ...payload])));
}

// self-test on startup (known vectors)
(() => {
  const empty = toHex(keccak256(new Uint8Array(0)));
  if (empty !== "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470") {
    die("keccak256 self-test failed");
  }
})();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const headers = () => {
  const h = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (reconcileVaultRewardsActivity)",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (adminToken) h.Authorization = `Bearer ${adminToken}`;
  return h;
};

async function authenticate() {
  if (adminToken) return;
  const username = process.env.STRATO_USERNAME || process.env.BA_USERNAME;
  const password = process.env.STRATO_PASSWORD || process.env.BA_PASSWORD;
  const clientId = process.env.OAUTH_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || process.env.CLIENT_SECRET;
  const discoveryUrl = process.env.OPENID_DISCOVERY_URL || process.env.OAUTH_URL;
  const missing = [
    ["STRATO_USERNAME", username],
    ["STRATO_PASSWORD", password],
    ["OAUTH_CLIENT_ID", clientId],
    ["OAUTH_CLIENT_SECRET", clientSecret],
    ["OPENID_DISCOVERY_URL", discoveryUrl],
  ].filter(([, value]) => !value);
  if (missing.length) {
    die(
      `Authentication requires ADMIN_TOKEN or user credentials. Missing: ` +
        missing.map(([name]) => name).join(", ")
    );
  }

  const discoveryResponse = await fetch(discoveryUrl, {
    headers: { Accept: "application/json" },
  });
  if (!discoveryResponse.ok) {
    die(`OAuth discovery failed: HTTP ${discoveryResponse.status}`);
  }
  const discovery = await discoveryResponse.json();
  if (!discovery.token_endpoint) die("OAuth discovery document has no token_endpoint");

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password,
    }),
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) {
    die(`OAuth login failed: HTTP ${tokenResponse.status}`);
  }
  adminToken = tokenBody.access_token;
}

async function httpJson(method, url, body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 500)}`);
      return text ? JSON.parse(text) : null;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.error(`  (retry ${attempt}/3 after error: ${String(e.message).split("\n")[0]})`);
      await sleep(2000 * attempt);
    }
  }
}

async function getAuthenticatedAddress() {
  const key = await httpJson("GET", `${NODE_URL}/strato/v2.3/key`);
  const address = String(key?.address || key?.userAddress || "")
    .toLowerCase()
    .replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(address)) {
    die(`Could not determine authenticated STRATO address from /key`);
  }
  return address;
}

async function verifyAuthenticatedAdmin() {
  const caller = await getAuthenticatedAddress();
  const rows = await cirrusGetAll("mapping", {
    address: `eq.${ADMIN_REGISTRY}`,
    collection_name: "eq.adminMap",
    "key->>key": `eq.${caller}`,
    select: "key,value::text",
  });
  const row = rows.find((entry) => plainKey(entry, 1));
  const raw = String(row?.value ?? "").replace(/^"|"$/g, "");
  if (chainUint(raw) === 0n) {
    die(`Authenticated caller ${caller} is not an AdminRegistry admin`);
  }
  return caller;
}

async function cirrusGet(table, params) {
  const url = new URL(`${NODE_URL}/cirrus/search/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return httpJson("GET", url.toString());
}

// Paged fetch: PostgREST caps responses, so walk with offset until short page.
async function cirrusGetAll(table, params) {
  const limit = 1000;
  const rows = [];
  for (let offset = 0; ; offset += limit) {
    const page = await cirrusGet(table, { ...params, limit: String(limit), offset: String(offset) });
    if (!Array.isArray(page)) die(`Unexpected Cirrus response from ${table}: ${JSON.stringify(page).slice(0, 200)}`);
    rows.push(...page);
    if (page.length < limit) return rows;
  }
}

// ---------------------------------------------------------------------------
// Transaction submission (mirrors rewards-poller strato.client.ts)
// ---------------------------------------------------------------------------

const functionTx = (contractName, contractAddress, method, callArgs) => ({
  type: "FUNCTION",
  payload: { contractName, contractAddress, method, args: callArgs },
});

const governanceTx = (target, method, callArgs) =>
  functionTx("AdminRegistry", ADMIN_REGISTRY, "castVoteOnIssue", {
    _target: target,
    _func: method,
    _args: callArgs,
  });

async function sendAndWait(txs, label) {
  if (!adminToken) die(`${label}: authentication is required to send transactions`);
  console.log(`  -> posting ${txs.length} tx(s): ${label}`);
  const response = await httpJson(
    "POST",
    `${NODE_URL}/strato/v2.3/transaction/parallel?resolve=true`,
    { txs, txParams: GAS }
  );
  if (!Array.isArray(response) || !response.length) {
    die(`${label}: invalid transaction response: ${JSON.stringify(response).slice(0, 300)}`);
  }
  const hashes = response.map((r, i) => {
    if (!r || !r.hash) die(`${label}: invalid tx result at index ${i}: ${JSON.stringify(r).slice(0, 300)}`);
    return r.hash;
  });

  const deadline = Date.now() + TX_POLL_TIMEOUT_MS;
  for (;;) {
    const results = await httpJson("POST", `${NODE_URL}/bloc/v2.2/transactions/results`, hashes);
    const failed = results.find((r) => r && r.status === "Failure");
    if (failed) {
      const msg =
        (failed.txResult && failed.txResult.message) || failed.error || failed.message || "Transaction failed";
      die(`${label}: transaction FAILED: ${msg}`);
    }
    if (results.every((r) => r && r.status !== "Pending")) {
      console.log(`  <- ${label}: ${results.map((r) => r.status).join(", ")} (${hashes.join(", ")})`);
      return { hashes, results };
    }
    if (Date.now() > deadline) die(`${label}: timed out waiting for tx results (${hashes.join(", ")})`);
    await sleep(TX_POLL_INTERVAL_MS);
  }
}

const isTrue = (value) => value === true || value === "true" || value === 1 || value === "1";

async function submitGovernanceVote(target, method, callArgs, label) {
  const { hashes, results } = await sendAndWait(
    [governanceTx(target, method, callArgs)],
    label
  );
  const contents =
    results[0]?.data?.contents ||
    results[0]?.txResult?.response?.contents ||
    results[0]?.response?.contents ||
    [];
  const didExecute = Array.isArray(contents) && isTrue(contents[0]);
  const issueId = Array.isArray(contents)
    ? contents.find(
        (value, index) =>
          index > 0 && typeof value === "string" && /^(0x)?[0-9a-f]{64}$/i.test(value)
      )
    : undefined;

  console.log(`\nGovernance vote submitted by ${await getAuthenticatedAddress()}`);
  console.log(`  transaction: ${hashes[0]}`);
  if (issueId) console.log(`  issue ID:    ${issueId.replace(/^0x/, "")}`);
  if (!didExecute) {
    console.log(
      "  status:      PENDING_VOTES\n" +
        "Vote on this issue in the Admin UI. Re-run this exact command after execution to verify state."
    );
  } else {
    console.log("  status:      EXECUTED");
  }
  return { didExecute, issueId };
}

// ---------------------------------------------------------------------------
// Chain state readers
// ---------------------------------------------------------------------------

// Cirrus splits some historical struct rows into per-field rows (key3 etc.);
// only rows keyed exactly as expected carry the live struct value.
const plainKey = (row, depth) => {
  const keys = Object.keys(row.key || {});
  const expected = ["key", "key2", "key3"].slice(0, depth);
  return keys.length === depth && expected.every((k) => keys.includes(k));
};

async function getActivityConfig() {
  const rows = await cirrusGetAll("mapping", {
    address: `eq.${REWARDS}`,
    collection_name: "eq.activities",
    "key->>key": `eq.${ACTIVITY_ID}`,
    select: "key,value",
  });
  const main = rows.find((r) => plainKey(r, 1));
  if (!main) die(`Activity ${ACTIVITY_ID} not found on Rewards ${REWARDS}`);
  const events = rows
    .filter((r) => plainKey(r, 3) && r.key.key2 === "actionableEvents")
    .sort((a, b) => Number(a.key.key3) - Number(b.key.key3))
    .map((r) => ({
      eventName: r.value.eventName,
      actionType: Number(chainUint(r.value.actionType)),
    }));
  return {
    name: main.value.name,
    sourceContract: String(main.value.sourceContract).toLowerCase(),
    emissionRate: chainUint(main.value.emissionRate).toString(),
    activityType: Number(chainUint(main.value.activityType)),
    minAmount: chainUint(main.value.minAmount).toString(),
    actionableEvents: events,
  };
}

async function getActivityState() {
  const rows = await cirrusGetAll("mapping", {
    address: `eq.${REWARDS}`,
    collection_name: "eq.activityStates",
    "key->>key": `eq.${ACTIVITY_ID}`,
    select: "key,value",
  });
  const main = rows.find((r) => plainKey(r, 1));
  if (!main) die(`activityStates[${ACTIVITY_ID}] not found`);
  return {
    totalStake: chainUint(main.value.totalStake).toString(),
    accRewardPerStake: chainUint(main.value.accRewardPerStake).toString(),
    lastUpdateTime: chainUint(main.value.lastUpdateTime).toString(),
  };
}

async function getStakes() {
  const rows = await cirrusGetAll("mapping", {
    address: `eq.${REWARDS}`,
    collection_name: "eq.userInfo",
    "key->>key2": `eq.${ACTIVITY_ID}`,
    select: "key,stake:value->>stake",
  });
  const stakes = {};
  for (const r of rows) {
    if (!plainKey(r, 2) || r.stake === null || r.stake === undefined) continue;
    stakes[String(r.key.key).toLowerCase()] = chainUint(r.stake).toString();
  }
  return stakes;
}

async function getBalances() {
  const rows = await cirrusGetAll("mapping", {
    address: `eq.${VAULT}`,
    collection_name: "eq._balances",
    select: "key,value::text",
  });
  const balances = {};
  for (const r of rows) {
    if (!plainKey(r, 1)) continue;
    const holder = String(r.key.key).toLowerCase();
    // value::text yields a JSON literal: digits, or "\"\"" for empty string
    const raw = String(r.value ?? "").replace(/^"|"$/g, "");
    balances[holder] = chainUint(raw).toString();
  }
  return balances;
}

async function getVaultScalars() {
  const rows = await cirrusGet("BlockApps-YieldVault", {
    address: `eq.${VAULT}`,
    select: "_totalSupply::text,totalQueuedShares::text,_paused,queueHead::text,nextRequestId::text",
  });
  if (!Array.isArray(rows) || !rows.length) die(`YieldVault ${VAULT} not found in Cirrus`);
  const v = rows[0];
  return {
    totalSupply: chainUint(v._totalSupply).toString(),
    totalQueuedShares: chainUint(v.totalQueuedShares).toString(),
    paused: v._paused === true,
    queueHead: chainUint(v.queueHead).toString(),
    nextRequestId: chainUint(v.nextRequestId).toString(),
  };
}

// Live queued-but-unprocessed shares per owner.
//
// Cirrus rows for deleted entries are not fully reliable: scalar mappings
// (requestOwner) are emptied on delete, but struct mappings (requests) can
// retain their last field values (observed with canceled request 4 on
// testnet). A request therefore only counts as live when BOTH its shares are
// > 0 AND requestOwner still holds an address. The snapshot phase cross-checks
// the sum against totalQueuedShares and the vault's self-balance, which
// catches any residual staleness.
async function getQueuedSharesByOwner() {
  const [requestRows, ownerRows] = await Promise.all([
    cirrusGetAll("mapping", {
      address: `eq.${VAULT}`,
      collection_name: "eq.requests",
      select: "key,shares:value->>shares",
    }),
    cirrusGetAll("mapping", {
      address: `eq.${VAULT}`,
      collection_name: "eq.requestOwner",
      select: "key,value",
    }),
  ]);
  const owners = {};
  for (const r of ownerRows) {
    if (!plainKey(r, 1)) continue;
    const owner = String(r.value ?? "").toLowerCase();
    if (owner && owner !== ZERO40) owners[String(r.key.key)] = owner;
  }
  const queued = {};
  for (const r of requestRows) {
    if (!plainKey(r, 1)) continue; // requests key is {key: requestId}
    const shares = chainUint(r.shares);
    if (shares === 0n) continue;
    const owner = owners[String(r.key.key)];
    if (!owner) continue; // stale Cirrus row for a deleted (canceled/processed) request
    queued[owner] = (chainUint(queued[owner] || "0") + shares).toString();
  }
  return queued;
}

async function getRewardsScalars() {
  const rows = await cirrusGet("BlockApps-Rewards", {
    address: `eq.${REWARDS}`,
    select: "maxBatchSize::text,highestBlockSeen::text",
  });
  if (!Array.isArray(rows) || !rows.length) die(`Rewards ${REWARDS} not found in Cirrus`);
  return {
    maxBatchSize: Number(chainUint(rows[0].maxBatchSize) || 100n),
    highestBlockSeen: chainUint(rows[0].highestBlockSeen).toString(),
  };
}

async function latestIndexedBlock() {
  // block_number is a text column, so order by the serial id (insertion order)
  // rather than lexicographically by block_number.
  const rows = await cirrusGet("event", {
    select: "block_number",
    order: "id.desc",
    limit: "1",
  });
  if (!Array.isArray(rows) || !rows.length) die("Could not determine latest indexed block");
  return Number(rows[0].block_number);
}

async function getVaultActionableEvents(names) {
  return cirrusGetAll("event", {
    address: `eq.${VAULT}`,
    event_name: `in.(${names.join(",")})`,
    select: "block_number,event_index,event_name,attributes,block_timestamp",
    order: "id.asc",
  });
}

// Probe processedEvents for a set of (blockNumber, eventIndex) pairs.
// Returns the subset of pairs that ARE already processed.
async function findProcessedPairs(pairs) {
  const byHash = new Map();
  for (const p of pairs) byHash.set(eventHash(p.blockNumber, p.eventIndex), p);
  const processed = [];
  for (const hashes of chunk([...byHash.keys()], 80)) {
    const rows = await cirrusGetAll("mapping", {
      address: `eq.${REWARDS}`,
      collection_name: "eq.processedEvents",
      "key->>key": `in.(${hashes.join(",")})`,
      select: "key",
    });
    for (const r of rows) {
      const hit = byHash.get(String(r.key.key));
      if (hit) processed.push(hit);
    }
  }
  return processed;
}

async function getMaxEventIndexAtBlock(blockNumber) {
  const rows = await cirrusGet("event", {
    block_number: `eq.${blockNumber}`,
    select: "event_index",
    order: "event_index.desc",
    limit: "1",
  });
  return Array.isArray(rows) && rows.length ? Number(rows[0].event_index) : -1;
}

async function countRewardsEventsSince(eventName, sinceIso) {
  const rows = await cirrusGetAll("event", {
    address: `eq.${REWARDS}`,
    event_name: `eq.${eventName}`,
    block_timestamp: `gte.${sinceIso}`,
    select: "block_number,event_index,attributes",
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Snapshot file handling
// ---------------------------------------------------------------------------

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    die(`Snapshot file ${SNAPSHOT_FILE} not found — run the snapshot phase first`);
  }
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf-8"));
  if (
    snap.network !== NETWORK ||
    snap.rewards !== REWARDS ||
    snap.vault !== VAULT ||
    String(snap.activityId) !== String(ACTIVITY_ID) ||
    snap.nodeUrl !== NODE_URL
  ) {
    die(
      `Snapshot file ${SNAPSHOT_FILE} was taken for a different target ` +
        `(network=${snap.network}, rewards=${snap.rewards}, vault=${snap.vault}, ` +
        `activity=${snap.activityId}, node=${snap.nodeUrl})`
    );
  }
  if (!Number.isSafeInteger(snap.batchSize) || snap.batchSize < 1) {
    die(`Snapshot ${SNAPSHOT_FILE} has no valid batchSize — take a new snapshot`);
  }
  return snap;
}

// Recompute what each user's stake SHOULD be: balance + queued shares.
function computeTargets(balances, queued) {
  const targets = {};
  for (const [holder, bal] of Object.entries(balances)) {
    if (holder === VAULT) continue; // vault's self-balance is queued-share custody
    if (chainUint(bal) > 0n) targets[holder] = bal;
  }
  for (const [owner, shares] of Object.entries(queued)) {
    targets[owner] = (chainUint(targets[owner] || "0") + chainUint(shares)).toString();
  }
  return targets;
}

// ---------------------------------------------------------------------------
// batchHandleAction plumbing
// ---------------------------------------------------------------------------

function buildBatchArgs(batch) {
  return [
    batch.map((a) => a.sourceContract),
    batch.map((a) => a.eventName),
    batch.map((a) => a.user),
    batch.map((a) => a.amount),
    batch.map((a) => a.blockNumber),
    batch.map((a) => a.eventIndex),
  ];
}

function selectActionBatch(actions, batchSize, label) {
  const batches = chunk(actions, batchSize);
  if (!Number.isSafeInteger(BATCH_NUMBER) || BATCH_NUMBER < 1 || BATCH_NUMBER > batches.length) {
    die(`${label}: --batch must be between 1 and ${batches.length}`);
  }
  return { batch: batches[BATCH_NUMBER - 1], batchCount: batches.length };
}

function printActions(title, actions) {
  console.log(`\n${title} (${actions.length} actions):`);
  for (const a of actions) {
    console.log(
      `  ${a.eventName.padEnd(14)} user=${a.user} amount=${fmt18(a.amount).padStart(28)} ` +
        `(block=${a.blockNumber}, idx=${a.eventIndex})`
    );
  }
}

async function executeActions(actions, batchSize, label, startedIso) {
  const { batch, batchCount } = selectActionBatch(actions, batchSize, label);
  console.log(`\nSelected ${label} batch ${BATCH_NUMBER}/${batchCount} (${batch.length} actions)`);
  const { didExecute } = await submitGovernanceVote(
    REWARDS,
    "batchHandleAction",
    buildBatchArgs(batch),
    `${label} batch ${BATCH_NUMBER}/${batchCount}`
  );
  if (!didExecute) return { didExecute: false, batch, batchCount };

  // batchHandleAction swallows per-action failures and emits ActionFailed
  // instead; give Cirrus a moment to index them before checking. The state
  // verification that follows each phase is the authoritative gate.
  await sleep(5000);
  const failures = await countRewardsEventsSince("ActionFailed", startedIso);
  const ours = failures.filter((f) => {
    const attrs = typeof f.attributes === "string" ? JSON.parse(f.attributes) : f.attributes || {};
    return String(attrs.sourceContract || "").toLowerCase() === VAULT;
  });
  if (ours.length) {
    console.error(`\nActionFailed events emitted during ${label}:`);
    for (const f of ours) console.error(`  ${JSON.stringify(f.attributes)}`);
    die(`${label}: ${ours.length} action(s) failed on-chain — investigate before continuing`);
  }
  return { didExecute: true, batch, batchCount };
}

async function waitForCirrus(check, description) {
  const deadline = Date.now() + CIRRUS_POLL_TIMEOUT_MS;
  for (;;) {
    const result = await check();
    if (result.ok) return result;
    if (Date.now() > deadline) {
      die(`Timed out waiting for Cirrus to reflect: ${description}\nLast state: ${result.detail}`);
    }
    console.log(`  ... waiting for Cirrus (${description}): ${result.detail}`);
    await sleep(CIRRUS_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Drift report (shared by status / snapshot / verify)
// ---------------------------------------------------------------------------

function driftReport(stakes, targets) {
  const users = [...new Set([...Object.keys(stakes), ...Object.keys(targets)])];
  const rows = users
    .map((u) => {
      const stake = chainUint(stakes[u] || "0");
      const target = chainUint(targets[u] || "0");
      return { user: u, stake, target, drift: stake - target };
    })
    .filter((r) => r.stake !== 0n || r.target !== 0n)
    .sort((a, b) => (b.drift < a.drift ? -1 : b.drift > a.drift ? 1 : 0))
    .reverse();

  console.log(`\n  ${"user".padEnd(40)} ${"tracked stake".padStart(26)} ${"correct (bal+queued)".padStart(26)} ${"drift".padStart(26)}`);
  let totalStake = 0n;
  let totalTarget = 0n;
  for (const r of rows) {
    totalStake += r.stake;
    totalTarget += r.target;
    const marker = r.drift === 0n ? "  " : " *";
    console.log(
      `  ${r.user.padEnd(40)} ${fmt18(r.stake).padStart(26)} ${fmt18(r.target).padStart(26)} ${fmt18(r.drift).padStart(26)}${marker}`
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(40)} ${fmt18(totalStake).padStart(26)} ${fmt18(totalTarget).padStart(26)} ${fmt18(totalStake - totalTarget).padStart(26)}`
  );
  return { totalStake, totalTarget };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function phasePreflight() {
  const [config, state, vault, rewardsScalars] = await Promise.all([
    getActivityConfig(),
    getActivityState(),
    getVaultScalars(),
    getRewardsScalars(),
  ]);
  if (config.sourceContract !== VAULT) {
    die(`Activity ${ACTIVITY_ID} sourceContract is ${config.sourceContract}, not ${VAULT}`);
  }
  let caller = "not authenticated (read-only)";
  if (
    adminToken ||
    process.env.STRATO_USERNAME ||
    process.env.BA_USERNAME
  ) {
    await authenticate();
    caller = await verifyAuthenticatedAdmin();
  }
  console.log(
    [
      "Preflight passed:",
      `  network:        ${NETWORK}`,
      `  node:           ${NODE_URL}`,
      `  rewards:        ${REWARDS}`,
      `  vault:          ${VAULT}`,
      `  activity:       ${ACTIVITY_ID} (${config.name})`,
      `  activity type:  ${config.activityType}`,
      `  emission rate:  ${config.emissionRate}`,
      `  total stake:    ${state.totalStake}`,
      `  vault paused:   ${vault.paused}`,
      `  max batch size: ${rewardsScalars.maxBatchSize}`,
      `  caller:         ${caller}`,
      `  snapshot:       ${SNAPSHOT_FILE}`,
    ].join("\n")
  );
}

async function phaseStatus() {
  const [config, state, stakes, balances, vault, queued] = await Promise.all([
    getActivityConfig(),
    getActivityState(),
    getStakes(),
    getBalances(),
    getVaultScalars(),
    getQueuedSharesByOwner(),
  ]);
  console.log(`\nActivity ${ACTIVITY_ID}: "${config.name}"  source=${config.sourceContract}`);
  console.log(`  actionable events: ${config.actionableEvents.map((e) => `${e.eventName}->${["Deposit", "Withdraw", "Occurred"][e.actionType]}`).join(", ")}`);
  console.log(`  emissionRate: ${config.emissionRate} (${fmt18(config.emissionRate)}/s)`);
  console.log(`  vault paused: ${vault.paused}  totalSupply: ${fmt18(vault.totalSupply)}  queued: ${fmt18(vault.totalQueuedShares)}`);
  console.log(`  activity totalStake: ${fmt18(state.totalStake)}`);

  const targets = computeTargets(balances, queued);
  const { totalStake, totalTarget } = driftReport(stakes, targets);
  console.log(
    `\n  activityStates.totalStake = ${fmt18(state.totalStake)} | sum(stakes) = ${fmt18(totalStake)} | vault totalSupply = ${fmt18(vault.totalSupply)} | sum(targets) = ${fmt18(totalTarget)}`
  );
}

async function phaseSnapshot() {
  console.log("Phase: snapshot");
  const [config, state, stakes, balances, vault, queued, rewardsScalars] = await Promise.all([
    getActivityConfig(),
    getActivityState(),
    getStakes(),
    getBalances(),
    getVaultScalars(),
    getQueuedSharesByOwner(),
    getRewardsScalars(),
  ]);

  // -- sanity checks -------------------------------------------------------
  if (config.sourceContract !== VAULT) {
    die(`Activity ${ACTIVITY_ID} sourceContract is ${config.sourceContract}, not VAULT_ADDRESS ${VAULT}`);
  }
  if (config.activityType !== 0) die(`Activity ${ACTIVITY_ID} is not a Position activity`);
  if (!vault.paused && !ALLOW_UNPAUSED) {
    die("Vault is NOT paused. Pause it first (pause phase), or pass --allow-unpaused to snapshot anyway.");
  }
  if (config.emissionRate !== "0") {
    die(
      `emissionRate is ${config.emissionRate} (${fmt18(config.emissionRate)}/s), not 0. ` +
        `Execute set-emission 0 before taking the snapshot.`
    );
  }

  const sumStakes = Object.values(stakes).reduce((a, v) => a + chainUint(v), 0n);
  if (sumStakes !== chainUint(state.totalStake)) {
    die(
      `sum(userInfo.stake) = ${sumStakes} != activityStates.totalStake = ${state.totalStake}. ` +
        `Cirrus may be lagging or a userInfo row was missed — refusing to snapshot.`
    );
  }
  const sumBalances = Object.values(balances).reduce((a, v) => a + chainUint(v), 0n);
  if (sumBalances !== chainUint(vault.totalSupply)) {
    die(`sum(_balances) = ${sumBalances} != _totalSupply = ${vault.totalSupply} — refusing to snapshot.`);
  }
  const vaultSelf = chainUint(balances[VAULT] || "0");
  const sumQueued = Object.values(queued).reduce((a, v) => a + chainUint(v), 0n);
  if (vaultSelf !== chainUint(vault.totalQueuedShares) || sumQueued !== chainUint(vault.totalQueuedShares)) {
    die(
      `Queued-share accounting mismatch: vault self-balance=${vaultSelf}, ` +
        `sum(live request shares)=${sumQueued}, totalQueuedShares=${vault.totalQueuedShares}`
    );
  }

  const targets = computeTargets(balances, queued);
  const sumTargets = Object.values(targets).reduce((a, v) => a + chainUint(v), 0n);
  if (sumTargets !== chainUint(vault.totalSupply)) {
    die(`sum(targets) = ${sumTargets} != _totalSupply = ${vault.totalSupply}`);
  }

  // -- reserve synthetic (blockNumber, eventIndex) pairs --------------------
  const snapshotBlock = await latestIndexedBlock();
  const maxIdxInBlock = await getMaxEventIndexAtBlock(snapshotBlock);
  if (maxIdxInBlock >= EVENT_INDEX_BASE) {
    die(`Block ${snapshotBlock} already has event_index ${maxIdxInBlock} >= EVENT_INDEX_BASE ${EVENT_INDEX_BASE}`);
  }

  const withdrawUsers = Object.entries(stakes)
    .filter(([, s]) => chainUint(s) > 0n)
    .map(([u]) => u)
    .sort();
  const seedUsers = Object.keys(targets).sort();

  const withdrawPairs = withdrawUsers.map((u, i) => ({
    user: u,
    blockNumber: snapshotBlock,
    eventIndex: EVENT_INDEX_BASE + i,
  }));
  const seedPairs = seedUsers.map((u, i) => ({
    user: u,
    blockNumber: snapshotBlock,
    eventIndex: EVENT_INDEX_BASE + SEED_INDEX_OFFSET + i,
  }));

  console.log(
    `\nVerifying ${withdrawPairs.length + seedPairs.length} reserved (block=${snapshotBlock}, index) pairs are unused on-chain...`
  );
  const collisions = await findProcessedPairs([...withdrawPairs, ...seedPairs]);
  if (collisions.length) {
    die(
      `Reserved pairs already exist in processedEvents (raise EVENT_INDEX_BASE): ` +
        collisions.map((c) => `(${c.blockNumber},${c.eventIndex})`).join(", ")
    );
  }
  console.log("  all reserved pairs are unused ✓");

  // -- drain check: real vault events not yet processed by the poller -------
  const eventNames = ["Deposit", "Withdraw", "QueueProcessed"];
  const vaultEvents = await getVaultActionableEvents(eventNames);
  const realPairs = vaultEvents.map((e) => ({
    blockNumber: Number(e.block_number),
    eventIndex: Number(e.event_index),
    eventName: e.event_name,
    attributes: typeof e.attributes === "string" ? JSON.parse(e.attributes) : e.attributes,
    block_timestamp: e.block_timestamp,
  }));
  const processedReal = await findProcessedPairs(realPairs);
  const processedKeys = new Set(processedReal.map((p) => `${p.blockNumber}:${p.eventIndex}`));
  const unprocessedReal = realPairs.filter((p) => !processedKeys.has(`${p.blockNumber}:${p.eventIndex}`));
  console.log(
    `\nVault event history: ${realPairs.length} actionable events, ${unprocessedReal.length} not in processedEvents`
  );
  const unprocessedDepositsWithdraws = unprocessedReal.filter((p) => p.eventName !== "QueueProcessed");
  if (unprocessedDepositsWithdraws.length) {
    console.warn(
      `  NOTE: ${unprocessedDepositsWithdraws.length} Deposit/Withdraw event(s) were never processed by the poller\n` +
        `  (skipped batches or events emitted after the poller stopped). Their effect is already inside\n` +
        `  the balance targets; the mark-historical phase will mark them processed so nothing replays them.`
    );
    for (const p of unprocessedDepositsWithdraws) {
      console.warn(`    ${p.eventName} block=${p.blockNumber} idx=${p.eventIndex} at ${p.block_timestamp}`);
    }
  }

  const snapshot = {
    takenAt: new Date().toISOString(),
    network: NETWORK,
    nodeUrl: NODE_URL,
    rewards: REWARDS,
    vault: VAULT,
    activityId: String(ACTIVITY_ID),
    snapshotBlock,
    eventIndexBase: EVENT_INDEX_BASE,
    seedIndexOffset: SEED_INDEX_OFFSET,
    maxBatchSize: rewardsScalars.maxBatchSize,
    batchSize:
      rewardsScalars.maxBatchSize > 0
        ? Math.min(BATCH_SIZE_ENV, rewardsScalars.maxBatchSize)
        : BATCH_SIZE_ENV,
    activityConfig: config,
    activityState: state,
    vaultState: vault,
    stakes,
    balances,
    queuedSharesByOwner: queued,
    targets,
    withdrawPairs,
    seedPairs,
    unprocessedRealEvents: unprocessedReal.map((p) => ({
      blockNumber: p.blockNumber,
      eventIndex: p.eventIndex,
      eventName: p.eventName,
      owner: String((p.attributes || {}).owner || "").toLowerCase(),
    })),
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot written to ${SNAPSHOT_FILE}`);

  const { totalStake, totalTarget } = driftReport(stakes, targets);
  console.log(`\nPlan:`);
  console.log(`  1. withdraw:        ${withdrawUsers.length} synthetic Withdraw actions (zero all stakes; settles earned rewards)`);
  console.log(`  2. set-events:      Deposit->Deposit, Withdraw->Withdraw, QueueProcessed->Withdraw`);
  console.log(`  3. mark-historical: mark ${unprocessedReal.length} real event(s) processed with zero-amount synthetics`);
  console.log(`  4. seed:            ${seedUsers.length} synthetic Deposit actions (target total ${fmt18(totalTarget)})`);
  console.log(`  5. verify:          totalStake == totalSupply == ${fmt18(vault.totalSupply)}`);
  console.log(`  aggregate drift being corrected: ${fmt18(totalStake - totalTarget)}`);
}

async function phaseWithdraw() {
  console.log("Phase: withdraw (zero out all tracked stakes)");
  const snap = loadSnapshot();
  const startedIso = new Date().toISOString();

  const actions = snap.withdrawPairs.map((p) => ({
    sourceContract: VAULT,
    eventName: "Withdraw",
    user: p.user,
    amount: snap.stakes[p.user],
    blockNumber: p.blockNumber,
    eventIndex: p.eventIndex,
  }));
  if (!actions.length) {
    console.log("No non-zero stakes to withdraw — nothing to do.");
    return;
  }
  const selected = selectActionBatch(actions, snap.batchSize, "withdraw");

  // Previously executed batches are allowed to be zero; every other stake must
  // still equal the snapshot, which catches a running poller or concurrent writer.
  const liveStakes = await getStakes();
  const users = new Set([...Object.keys(liveStakes), ...Object.keys(snap.stakes)]);
  for (const u of users) {
    const live = chainUint(liveStakes[u] || "0");
    const snapStake = chainUint(snap.stakes[u] || "0");
    if (live !== 0n && live !== snapStake) {
      die(
        `Stake for ${u} changed unexpectedly since snapshot (${snapStake} -> ${live}). ` +
          `Is the rewards poller still running?`
      );
    }
  }
  if (selected.batch.every((action) => chainUint(liveStakes[action.user] || "0") === 0n)) {
    console.log(`Withdraw batch ${BATCH_NUMBER}/${selected.batchCount} is already complete.`);
    return;
  }
  printActions(
    `Synthetic Withdraw batch ${BATCH_NUMBER}/${selected.batchCount}`,
    selected.batch
  );

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return;
  }
  const result = await executeActions(actions, snap.batchSize, "withdraw", startedIso);
  if (!result.didExecute) return;

  await waitForCirrus(async () => {
    const [state, stakes] = await Promise.all([getActivityState(), getStakes()]);
    const batchNonZero = result.batch.filter(
      (action) => chainUint(stakes[action.user] || "0") > 0n
    );
    if (batchNonZero.length === 0) return { ok: true };
    return {
      ok: false,
      detail: `totalStake=${state.totalStake}, ${batchNonZero.length} users in this batch still staked`,
    };
  }, "all stakes in the executed withdraw batch are zero");
  const state = await getActivityState();
  if (chainUint(state.totalStake) === 0n) {
    console.log(`\nOK: activityStates[${ACTIVITY_ID}].totalStake == 0 and every tracked stake is zero.`);
  } else {
    console.log(
      `\nOK: withdraw batch ${BATCH_NUMBER}/${result.batchCount} executed. ` +
        `Remaining totalStake: ${fmt18(state.totalStake)}. Execute the next batch.`
    );
  }
}

async function phaseSetEvents() {
  console.log("Phase: set-events (register QueueProcessed as a Withdraw trigger)");
  const [state, currentConfig] = await Promise.all([getActivityState(), getActivityConfig()]);
  if (chainUint(state.totalStake) !== 0n) {
    die(`totalStake is ${state.totalStake}, not 0 — run the withdraw phase first`);
  }
  const currentNames = currentConfig.actionableEvents
    .map((event) => `${event.eventName}:${event.actionType}`)
    .join(",");
  if (currentNames === "Deposit:0,Withdraw:1,QueueProcessed:1") {
    console.log("Actionable events are already configured correctly — nothing to do.");
    return;
  }

  const newEvents = [
    { eventName: "Deposit", actionType: "Deposit" },
    { eventName: "Withdraw", actionType: "Withdraw" },
    { eventName: "QueueProcessed", actionType: "Withdraw" },
  ];
  console.log("  setPositionActivityEvents args:", JSON.stringify(newEvents));

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return;
  }
  const { didExecute } = await submitGovernanceVote(
    REWARDS,
    "setPositionActivityEvents",
    [Number(ACTIVITY_ID), newEvents],
    "setPositionActivityEvents"
  );
  if (!didExecute) return;

  await waitForCirrus(async () => {
    const config = await getActivityConfig();
    const names = config.actionableEvents.map((e) => `${e.eventName}:${e.actionType}`).join(",");
    const ok = names === "Deposit:0,Withdraw:1,QueueProcessed:1";
    return { ok, detail: `actionableEvents = [${names}]` };
  }, "actionable events updated to Deposit/Withdraw/QueueProcessed");
  console.log("\nOK: actionable events are Deposit->Deposit, Withdraw->Withdraw, QueueProcessed->Withdraw.");
}

async function phaseMarkHistorical() {
  console.log("Phase: mark-historical (idempotency-mark unprocessed real vault events)");
  const snap = loadSnapshot();
  const startedIso = new Date().toISOString();

  const config = await getActivityConfig();
  const hasQueueProcessed = config.actionableEvents.some((e) => e.eventName === "QueueProcessed");
  if (!hasQueueProcessed) die("QueueProcessed is not an actionable event yet — run set-events first");

  const historical = snap.unprocessedRealEvents || [];
  if (!historical.length) {
    console.log("All real vault events are already marked processed — nothing to do.");
    return;
  }

  // amount = 0: _handleAction marks the (block,index) hash processed and returns
  // before touching any stake, so this cannot change positions or rewards.
  const actions = historical.map((p) => ({
    sourceContract: VAULT,
    eventName: p.eventName,
    user: String(p.owner || "").toLowerCase() || VAULT,
    amount: "0",
    blockNumber: p.blockNumber,
    eventIndex: p.eventIndex,
  }));
  const selected = selectActionBatch(actions, snap.batchSize, "mark-historical");
  const alreadyProcessed = await findProcessedPairs(selected.batch);
  if (alreadyProcessed.length === selected.batch.length) {
    console.log(
      `Historical marker batch ${BATCH_NUMBER}/${selected.batchCount} is already complete.`
    );
    return;
  }
  if (alreadyProcessed.length) {
    die(`Historical marker batch ${BATCH_NUMBER} is only partially processed — investigate`);
  }
  printActions(
    `Zero-amount marker batch ${BATCH_NUMBER}/${selected.batchCount}`,
    selected.batch
  );

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return;
  }
  const result = await executeActions(actions, snap.batchSize, "mark-historical", startedIso);
  if (!result.didExecute) return;

  await waitForCirrus(async () => {
    const nowProcessed = await findProcessedPairs(result.batch);
    return {
      ok: nowProcessed.length === result.batch.length,
      detail: `${nowProcessed.length}/${result.batch.length} marked`,
    };
  }, "selected historical event batch marked processed");
  console.log(
    `\nOK: historical marker batch ${BATCH_NUMBER}/${result.batchCount} is complete.`
  );

  // stakes must be untouched by this phase
  const state = await getActivityState();
  if (chainUint(state.totalStake) !== 0n) {
    die(`totalStake changed to ${state.totalStake} during mark-historical — investigate immediately`);
  }
}

async function phaseSeed() {
  console.log("Phase: seed (re-create correct positions)");
  const snap = loadSnapshot();
  const startedIso = new Date().toISOString();

  const config = await getActivityConfig();
  if (!config.actionableEvents.some((e) => e.eventName === "QueueProcessed")) {
    die("Actionable events not updated yet — run set-events before seed");
  }

  // Freshness check: carryETH transfers are NOT blocked by pause, so balances
  // can have moved since snapshot. Refuse to seed stale targets.
  const [balances, queued, vault] = await Promise.all([
    getBalances(),
    getQueuedSharesByOwner(),
    getVaultScalars(),
  ]);
  const liveTargets = computeTargets(balances, queued);
  let targets = snap.targets;
  const changed = [...new Set([...Object.keys(liveTargets), ...Object.keys(snap.targets)])].filter(
    (u) => chainUint(liveTargets[u] || "0") !== chainUint(snap.targets[u] || "0")
  );
  if (changed.length) {
    die(
      `Balances moved since snapshot for: ${changed.join(", ")}.\n` +
        `Re-run snapshot so every admin votes on the same immutable seed payload.`
    );
  }

  const seedIndexByUser = new Map(snap.seedPairs.map((p) => [p.user, p.eventIndex]));
  let nextExtraIndex =
    snap.eventIndexBase + snap.seedIndexOffset + snap.seedPairs.length;

  const actions = Object.entries(targets)
    .filter(([, t]) => chainUint(t) > 0n)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([user, amount]) => ({
      sourceContract: VAULT,
      eventName: "Deposit",
      user,
      amount,
      blockNumber: snap.snapshotBlock,
      eventIndex: seedIndexByUser.get(user) ?? nextExtraIndex++,
    }));

  // Pairs for users that appeared after the snapshot were never reserved;
  // make sure they are unused before sending anything.
  const extraPairs = actions.filter((a) => !seedIndexByUser.has(a.user));
  if (extraPairs.length) {
    const collisions = await findProcessedPairs(extraPairs);
    if (collisions.length) {
      die(
        `Unreserved seed pairs already processed: ` +
          collisions.map((c) => `(${c.blockNumber},${c.eventIndex})`).join(", ")
      );
    }
  }

  if (!actions.length) die("No targets to seed — is the vault empty?");
  const selected = selectActionBatch(actions, snap.batchSize, "seed");
  const liveStakes = await getStakes();
  for (const [user, stake] of Object.entries(liveStakes)) {
    const live = chainUint(stake);
    const target = chainUint(targets[user] || "0");
    if (live !== 0n && live !== target) {
      die(`Unexpected partial seed for ${user}: stake=${live}, target=${target}`);
    }
  }
  if (
    selected.batch.every(
      (action) => chainUint(liveStakes[action.user] || "0") === chainUint(action.amount)
    )
  ) {
    console.log(`Seed batch ${BATCH_NUMBER}/${selected.batchCount} is already complete.`);
    return;
  }
  printActions(`Synthetic Deposit batch ${BATCH_NUMBER}/${selected.batchCount}`, selected.batch);
  const total = actions.reduce((a, x) => a + chainUint(x.amount), 0n);
  console.log(`\n  target total: ${fmt18(total)} | vault totalSupply: ${fmt18(vault.totalSupply)}`);
  if (total !== chainUint(vault.totalSupply)) {
    die("Seed total != live vault totalSupply — refusing to proceed");
  }

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return;
  }
  const result = await executeActions(actions, snap.batchSize, "seed", startedIso);
  if (!result.didExecute) return;

  await waitForCirrus(async () => {
    const [liveState, stakes] = await Promise.all([getActivityState(), getStakes()]);
    const bad = result.batch.filter(
      (action) => chainUint(stakes[action.user] || "0") !== chainUint(action.amount)
    );
    if (bad.length === 0) return { ok: true };
    return {
      ok: false,
      detail: `totalStake=${liveState.totalStake}, ${bad.length} users in this batch mismatched`,
    };
  }, "every stake in the executed seed batch matches its target");
  const state = await getActivityState();
  if (chainUint(state.totalStake) === total) {
    console.log(`\nOK: all positions seeded; totalStake == totalSupply == ${fmt18(total)}.`);
  } else {
    console.log(
      `\nOK: seed batch ${BATCH_NUMBER}/${result.batchCount} executed. ` +
        `Current totalStake: ${fmt18(state.totalStake)}. Execute the next batch.`
    );
  }
}

async function phaseVerify() {
  console.log("Phase: verify");
  const [config, state, stakes, balances, vault, queued] = await Promise.all([
    getActivityConfig(),
    getActivityState(),
    getStakes(),
    getBalances(),
    getVaultScalars(),
    getQueuedSharesByOwner(),
  ]);
  const targets = computeTargets(balances, queued);
  const { totalStake, totalTarget } = driftReport(stakes, targets);

  const eventNames = config.actionableEvents.map((e) => `${e.eventName}:${e.actionType}`).join(",");
  const checks = [
    ["actionable events = Deposit:0,Withdraw:1,QueueProcessed:1", eventNames === "Deposit:0,Withdraw:1,QueueProcessed:1", eventNames],
    ["sum(stakes) == activityStates.totalStake", totalStake === chainUint(state.totalStake), `${totalStake} vs ${state.totalStake}`],
    ["totalStake == vault totalSupply", chainUint(state.totalStake) === chainUint(vault.totalSupply), `${state.totalStake} vs ${vault.totalSupply}`],
    ["per-user stake == balance + queued", Object.keys(targets).every((u) => chainUint(stakes[u] || "0") === chainUint(targets[u])) && Object.keys(stakes).every((u) => chainUint(stakes[u]) === chainUint(targets[u] || "0")), `${fmt18(totalStake - totalTarget)} residual drift`],
  ];

  console.log("");
  let allOk = true;
  for (const [name, ok, detail] of checks) {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : `  (${detail})`}`);
    if (!ok) allOk = false;
  }
  if (!allOk) die("Verification FAILED");
  console.log(`\nAll checks passed. Activity ${ACTIVITY_ID} totalStake = ${fmt18(state.totalStake)} = vault totalSupply.`);
  console.log("Next: deploy the poller with the updated attributeMapping.json, start it, unpause the vault, then enable emissions.");
}

async function phaseVaultPause(pause) {
  const method = pause ? "pause" : "unpause";
  console.log(`Phase: ${method} YieldVault ${VAULT}`);
  const vault = await getVaultScalars();
  if (vault.paused === pause) {
    console.log(`Vault is already ${pause ? "paused" : "unpaused"} — nothing to do.`);
    return;
  }
  if (!EXECUTE) {
    console.log("Dry run (pass --execute to send).");
    return;
  }
  const { didExecute } = await submitGovernanceVote(VAULT, method, [], method);
  if (!didExecute) return;
  await waitForCirrus(async () => {
    const v = await getVaultScalars();
    return { ok: v.paused === pause, detail: `_paused=${v.paused}` };
  }, `vault ${method}d`);
  console.log(`OK: vault is ${pause ? "paused" : "unpaused"}.`);
}

async function phaseSetEmission() {
  const rate = args[1];
  if (rate === undefined || !/^\d+$/.test(rate)) {
    die("Usage: set-emission <rate-in-wei-per-second> [--execute]");
  }
  console.log(`Phase: set-emission ${rate} (${fmt18(rate)}/s) for activity ${ACTIVITY_ID}`);
  const config = await getActivityConfig();
  if (config.emissionRate === rate) {
    console.log("Emission rate is already set to this value — nothing to do.");
    return;
  }
  if (!EXECUTE) {
    console.log("Dry run (pass --execute to send).");
    return;
  }
  const { didExecute } = await submitGovernanceVote(
    REWARDS,
    "setEmissionRate",
    [Number(ACTIVITY_ID), rate],
    "setEmissionRate"
  );
  if (!didExecute) return;
  await waitForCirrus(async () => {
    const config = await getActivityConfig();
    return { ok: config.emissionRate === rate, detail: `emissionRate=${config.emissionRate}` };
  }, "emission rate updated");
  console.log("OK: emission rate updated.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  if (!PROFILE) die("NETWORK or --network must be testnet or prod");
  if (!NODE_URL) die("NODE_URL env var required");
  if (!REWARDS || REWARDS.length !== 40) die("REWARDS_ADDRESS env var required (40 hex chars, no 0x)");
  if (!VAULT || VAULT.length !== 40) die("VAULT_ADDRESS env var required (40 hex chars, no 0x)");
  if (!ACTIVITY_ID || !/^\d+$/.test(ACTIVITY_ID)) die("ACTIVITY_ID env var required (integer)");
  if (!Number.isSafeInteger(BATCH_SIZE_ENV) || BATCH_SIZE_ENV < 1) die("BATCH_SIZE must be a positive integer");
  if (!Number.isSafeInteger(BATCH_NUMBER) || BATCH_NUMBER < 1) die("--batch must be a positive integer");

  const phases = {
    preflight: phasePreflight,
    status: phaseStatus,
    pause: () => phaseVaultPause(true),
    snapshot: phaseSnapshot,
    withdraw: phaseWithdraw,
    "set-events": phaseSetEvents,
    "mark-historical": phaseMarkHistorical,
    seed: phaseSeed,
    verify: phaseVerify,
    unpause: () => phaseVaultPause(false),
    "set-emission": phaseSetEmission,
  };

  if (!phase || !phases[phase]) {
    console.error(
      `Usage: node ${path.basename(__filename)} <${Object.keys(phases).join("|")}> ` +
        `--network <testnet|prod> [--execute] [--confirm-prod] [--batch <number>] [--allow-unpaused]`
    );
    process.exit(1);
  }

  if (EXECUTE) {
    if (NETWORK === "prod" && !CONFIRM_PROD) {
      die("Production execution requires --confirm-prod");
    }
    await authenticate();
    const caller = await verifyAuthenticatedAdmin();
    const config = await getActivityConfig();
    if (config.sourceContract !== VAULT) {
      die(`Activity ${ACTIVITY_ID} sourceContract is ${config.sourceContract}, not ${VAULT}`);
    }
    console.log(`authenticated admin=${caller}`);
  }

  console.log(
    `network=${NETWORK}\nnode=${NODE_URL}\nrewards=${REWARDS}\nvault=${VAULT}\n` +
      `activity=${ACTIVITY_ID}\nmode=${EXECUTE ? "EXECUTE" : "dry-run"}\n`
  );
  await phases[phase]();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
