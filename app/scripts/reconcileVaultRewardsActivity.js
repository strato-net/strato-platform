/*
  Script: reconcileVaultRewardsActivity.js
  Purpose: Reconcile a transferable-vault Position activity (SaveUSDST or
           YieldVault shares) on the Rewards contract whose event-derived
           positions have drifted: wallet-to-wallet share transfers were never
           relayed (strato-net/private#253), and on YieldVaults QueueProcessed
           events were once not counted as withdrawals.

           The reconciliation resets every tracked position with synthetic Withdraw
           actions (settling previously earned rewards without deleting them),
           registers the vault's Transfer event (and QueueProcessed on YieldVaults)
           as actionable events, marks all historical unprocessed vault events as
           processed (so no cursor replay can double-apply them), and re-seeds every
           current holder's stake from their share balance (+ unprocessed queued
           shares on YieldVaults). Shares held by the vault itself or by a native
           custody vault are not positions.

  Requirements: Node >= 18 (global fetch). No external dependencies.

  Environment:
    ENV_FILE          optional env file path (default app/scripts/.env)
    NETWORK           testnet or prod (required)
    VAULT             profile key (required): saveusdst, eth, wbtc, usdc, goldst,
                      silvst, hype
    NODE_URL          optional profile override
    POLLER_TOKEN      optional rewards-poller OAuth bearer token
    POLLER_NAME, POLLER_PASSWORD (or BA_USERNAME, BA_PASSWORD)
                      credentials of the live deployed rewards-poller service
                      account; the identity every batch is posted as, and the
                      only one whitelisted for batchHandleAction and
                      batchHandleTransfer
    ADMIN_NAME, ADMIN_PASSWORD (or GLOBAL_ADMIN_NAME, GLOBAL_ADMIN_PASSWORD)
                      optional admin used by the run phase to cast the first
                      vote on each governed call; without it the run phase only
                      announces the call and waits for the admins
    OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_URL, OAUTH_TOTP
                      OAuth client both accounts belong to
    RESTORE_EMISSION_RATE
                      rate the run phase restores after reconciliation (default:
                      the rate found before freezing, or the snapshot's record)
    VOTE_TIMEOUT_MS   how long the run phase waits for a governed call to execute
                      (default 3600000)
    REWARDS_ADDRESS, VAULT_ADDRESS, ACTIVITY_ID, VAULT_KIND (yield|save),
    CUSTODY_ADDRESSES (comma-separated)
                      optional profile overrides
    SNAPSHOT_FILE     Where snapshot state is stored
                      (default ./reconcile-<network>-<vault>-activity-<id>.snapshot.json)
    EVENT_INDEX_BASE  First synthetic eventIndex (default 1000000)
    BATCH_SIZE        Actions per batch tx (default 50, capped by the contract's
                      maxBatchSize)
    INSECURE_TLS=1    Disable TLS verification (equivalent of curl -k)

  Usage:
    node reconcileVaultRewardsActivity.js <phase> --network <testnet|prod>
      --vault <profile key>
      [--execute] [--confirm-prod] [--batch <number>]
      [--confirm-poller-stopped]

  Batches are always posted as the rewards-poller service account. Governed
  actions need two admin votes: the run phase casts the first one itself when
  ADMIN_NAME is set and then waits for the second admin, like deploy/upgrade.js
  waits for IssueExecuted; the single phases leave them to admins in SMD.

  One command per vault (stop and drain the rewards poller first):
    run              freeze (setEmissionRate 0, pause) -> snapshot -> withdraw
                     -> setPositionActivityEvents -> mark-historical -> seed
                     -> verify -> unfreeze (unpause, setEmissionRate restore),
                     every batch included; re-run to resume after a failure

  Single phases (in operational order):
    preflight        Validate target configuration, require emission rate 0, and
                     confirm the poller is whitelisted for batchHandleAction and
                     batchHandleTransfer
    status           Show current drift (per-user stake vs balance+queued)
    [SMD] Rewards.setEmissionRate(activityId, 0)
    [SMD] <vault>.pause()
    (stop and drain the rewards poller before continuing)
    snapshot         Snapshot stakes/balances/queue, reserve + verify synthetic
                     (blockNumber, eventIndex) pairs, write SNAPSHOT_FILE
    withdraw         One synthetic Withdraw batch (zeroes every tracked stake)
    [SMD] Rewards.setPositionActivityEvents(activityId, Deposit->Deposit,
          Withdraw->Withdraw, [QueueProcessed->Withdraw,] Transfer->Transfer)
          — requires totalStake 0
    mark-historical  Historical marker batches (zero-amount actions and transfers)
    seed             One synthetic Deposit batch
    verify           Final invariant check + drain check
    [SMD] <vault>.unpause(), then Rewards.setEmissionRate back to the rate
          recorded by status

  Every mutating phase is a dry run unless --execute is passed.
*/

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, "");
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
};

loadEnvFile(process.env.ENV_FILE || path.join(__dirname, ".env"));

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

// Transferable-vault Position activities. `kind` selects the vault contract
// table and whether queued withdrawals exist; `custody` lists the native-bridge
// custody vault(s) whose share balance is not a user position (keep in sync with
// app/services/rewards-poller/src/infra/config/positionEventSourceConfig.json).
const NETWORK_PROFILES = {
  testnet: {
    nodeUrl: "https://app.testnet.strato.nexus",
    rewards: "170147f58738c9f46112a874030420b823901f3b",
    custody: ["8cfe7b576f69260673e9a1a9517137f12a49ed93"],
    vaults: {
      saveusdst: { kind: "save", address: "ceeb982f671b4ee2b4471e5b49f3126739537f15", activityId: "20" },
      eth: { kind: "yield", address: "ac8ce8b3d4aa4b9a359dad3bb792a563f7f2e2f5", activityId: "22" },
      wbtc: { kind: "yield", address: "97d3b5da244094dd940a173b42240b36eb79dceb", activityId: "23" },
      usdc: { kind: "yield", address: "9c9bcc6e040910c6705d15864067720923bacc82", activityId: "24" },
      goldst: { kind: "yield", address: "65ab8049ff949e7ed04838723a07bc9b5a7849e2", activityId: "26" },
      silvst: { kind: "yield", address: "7ecc1ab7e15384cf2392b7dad8878239fda78799", activityId: "27" },
      hype: { kind: "yield", address: "52042da4c65e8226472b4869019a0aee6d920e21", activityId: "31" },
    },
  },
  prod: {
    nodeUrl: "https://app.strato.nexus",
    rewards: "4a116cf8cb056036632aef08f7c0df27c720f1c0",
    custody: ["db967ac5c497e6a2bd6f89036d2b63851760318f"],
    vaults: {
      saveusdst: { kind: "save", address: "22550671fcad04a213697ac7ae4f4366e96446ed", activityId: "24" },
      eth: { kind: "yield", address: "a94905d8bd117e9bfbe57aadffd7abbea760e028", activityId: "27" },
      wbtc: { kind: "yield", address: "0b5831edcab6f06256a790340426236c31bb463f", activityId: "28" },
      usdc: { kind: "yield", address: "afcfc4d847d59fbc402856fd6934aff6796812b1", activityId: "29" },
      goldst: { kind: "yield", address: "ddf7c27f27ac43b25043e100c2076e515526b9ae", activityId: "30" },
      silvst: { kind: "yield", address: "f8884c44d7cfbfb7c6326c515f375f8572f03e2b", activityId: "31" },
      hype: { kind: "yield", address: "fc6b457bf1629c74acd4b33ba49ddc2365d9855b", activityId: "32" },
    },
  },
};

const NETWORK = String(optionValue("--network") || process.env.NETWORK || "").toLowerCase();
const PROFILE = NETWORK_PROFILES[NETWORK];
const VAULT_KEY = String(optionValue("--vault") || process.env.VAULT || "").toLowerCase();
const VAULT_PROFILE = PROFILE?.vaults?.[VAULT_KEY];
const NODE_URL = (process.env.NODE_URL || PROFILE?.nodeUrl || "").replace(/\/+$/, "");
const IDENTITIES = {
  poller: {
    username: process.env.POLLER_NAME || process.env.BA_USERNAME,
    password: process.env.POLLER_PASSWORD || process.env.BA_PASSWORD,
    token: process.env.POLLER_TOKEN || "",
  },
  admin: {
    username: process.env.ADMIN_NAME || process.env.GLOBAL_ADMIN_NAME,
    password: process.env.ADMIN_PASSWORD || process.env.GLOBAL_ADMIN_PASSWORD,
    token: "",
  },
};
const REWARDS = (process.env.REWARDS_ADDRESS || PROFILE?.rewards || "").toLowerCase().replace(/^0x/, "");
const VAULT = (process.env.VAULT_ADDRESS || VAULT_PROFILE?.address || "").toLowerCase().replace(/^0x/, "");
const ACTIVITY_ID = process.env.ACTIVITY_ID || VAULT_PROFILE?.activityId;
const VAULT_KIND = String(process.env.VAULT_KIND || VAULT_PROFILE?.kind || "").toLowerCase();
const CUSTODY = new Set(
  String(process.env.CUSTODY_ADDRESSES || (PROFILE?.custody || []).join(","))
    .split(",")
    .map((address) => address.trim().toLowerCase().replace(/^0x/, ""))
    .filter(Boolean)
);
const ADMIN_REGISTRY = (process.env.ADMIN_REGISTRY_ADDRESS || "000000000000000000000000000000000000100c")
  .toLowerCase()
  .replace(/^0x/, "");
const EVENT_INDEX_BASE = Number(process.env.EVENT_INDEX_BASE || 1000000);
const SEED_INDEX_OFFSET = 100000; // seed pairs live at EVENT_INDEX_BASE + SEED_INDEX_OFFSET + i
const BATCH_SIZE_ENV = Number(process.env.BATCH_SIZE || 50);
const SNAPSHOT_FILE =
  process.env.SNAPSHOT_FILE ||
  `./reconcile-${NETWORK}-${VAULT_KEY}-activity-${ACTIVITY_ID}.snapshot.json`;
const HAS_TARGET_OVERRIDE =
  Boolean(process.env.NODE_URL && NODE_URL !== PROFILE?.nodeUrl) ||
  Boolean(process.env.REWARDS_ADDRESS && REWARDS !== PROFILE?.rewards) ||
  Boolean(process.env.VAULT_ADDRESS && VAULT !== VAULT_PROFILE?.address) ||
  Boolean(process.env.ACTIVITY_ID && String(ACTIVITY_ID) !== VAULT_PROFILE?.activityId) ||
  Boolean(process.env.VAULT_KIND && VAULT_KIND !== VAULT_PROFILE?.kind) ||
  Boolean(process.env.CUSTODY_ADDRESSES) ||
  Boolean(process.env.ADMIN_REGISTRY_ADDRESS);
const PROD_TARGETS = Object.values(NETWORK_PROFILES.prod.vaults);
const RESOLVES_TO_PROD =
  NETWORK === "prod" ||
  NODE_URL === NETWORK_PROFILES.prod.nodeUrl ||
  REWARDS === NETWORK_PROFILES.prod.rewards ||
  PROD_TARGETS.some(
    (target) =>
      VAULT === target.address || String(ACTIVITY_ID) === target.activityId
  );

const GAS = { gasLimit: 32100000000, gasPrice: 1 }; // same as rewards-poller
const TX_POLL_INTERVAL_MS = 5000;
const TX_POLL_TIMEOUT_MS = 600000;
const CIRRUS_POLL_INTERVAL_MS = 3000;
const CIRRUS_POLL_TIMEOUT_MS = 180000;
const VOTE_POLL_INTERVAL_MS = 10000;
const VOTE_TIMEOUT_MS = Number(process.env.VOTE_TIMEOUT_MS || 3600000); // same bound as deploy/upgrade.js

const ZERO40 = "0000000000000000000000000000000000000000";

const EXECUTE = args.includes("--execute");
const CONFIRM_PROD = args.includes("--confirm-prod");
const CONFIRM_POLLER_STOPPED = args.includes("--confirm-poller-stopped");
const BATCH_NUMBER = Number(optionValue("--batch") || 1);
const POLLER_STOPPED_PHASES = new Set([
  "run",
  "snapshot",
  "withdraw",
  "mark-historical",
  "seed",
]);

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

const parseEnumValue = (value, names, label) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (value === null || value === undefined || normalized === "") {
    die(`Missing ${label} value from Cirrus`);
  }
  if (Object.prototype.hasOwnProperty.call(names, normalized)) {
    return names[normalized];
  }
  try {
    const numeric = Number(chainUint(value));
    if (Object.values(names).includes(numeric)) return numeric;
  } catch {
    // Fall through to the explicit error below.
  }
  die(`Unknown ${label} value from Cirrus: ${String(value)}`);
};

const parseActivityType = (value) =>
  parseEnumValue(value, { position: 0, onetime: 1 }, "activityType");

const parseActionType = (value) =>
  parseEnumValue(
    value,
    { deposit: 0, withdraw: 1, occurred: 2, transfer: 3 },
    "actionType"
  );

const ACTION_TYPE_NAMES = ["Deposit", "Withdraw", "Occurred", "Transfer"];
const TRANSFER_EVENT = "Transfer";
// Vault events the poller relays as Deposit/Withdraw actions, per vault kind.
const VAULT_ACTION_EVENTS =
  VAULT_KIND === "yield" ? ["Deposit", "Withdraw", "QueueProcessed"] : ["Deposit", "Withdraw"];
const VAULT_CONTRACT_NAME = VAULT_KIND === "yield" ? "YieldVault" : "SaveUSDSTVault";
// Actionable events the activity must have after reconciliation.
const EXPECTED_EVENTS = [
  { eventName: "Deposit", actionType: 0 },
  { eventName: "Withdraw", actionType: 1 },
  ...(VAULT_KIND === "yield" ? [{ eventName: "QueueProcessed", actionType: 1 }] : []),
  { eventName: TRANSFER_EVENT, actionType: 3 },
];
const EXPECTED_POSITION_EVENTS = EXPECTED_EVENTS.map((e) => `${e.eventName}:${e.actionType}`).join(",");
// setPositionActivityEvents argument: the VM wants enum members by name.
const expectedEventsArgs = () =>
  EXPECTED_EVENTS.map((e) => ({ eventName: e.eventName, actionType: ACTION_TYPE_NAMES[e.actionType] }));
const actionableEventsSignature = (config) =>
  config.actionableEvents
    .map((event) => `${event.eventName}:${event.actionType}`)
    .join(",");

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

const headers = (identity) => {
  const h = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "node-fetch/reconcileVaultRewardsActivity",
    "X-Requested-With": "XMLHttpRequest",
  };
  const token = IDENTITIES[identity]?.token;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

async function login(identity) {
  const account = IDENTITIES[identity];
  if (account.token) return;
  const { username, password } = account;
  const clientId = process.env.OAUTH_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET || process.env.CLIENT_SECRET;
  const discoveryUrl = process.env.OPENID_DISCOVERY_URL || process.env.OAUTH_URL;
  const isAdmin = identity === "admin";
  const missing = [
    [isAdmin ? "ADMIN_NAME/GLOBAL_ADMIN_NAME" : "POLLER_NAME/BA_USERNAME", username],
    [isAdmin ? "ADMIN_PASSWORD/GLOBAL_ADMIN_PASSWORD" : "POLLER_PASSWORD/BA_PASSWORD", password],
    ["OAUTH_CLIENT_ID", clientId],
    ["OAUTH_CLIENT_SECRET", clientSecret],
    ["OPENID_DISCOVERY_URL/OAUTH_URL", discoveryUrl],
  ].filter(([, value]) => !value);
  if (missing.length) {
    die(
      `Authentication as ${identity} requires ${isAdmin ? "" : "POLLER_TOKEN or "}credentials. Missing: ` +
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

  const tokenParams = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password,
  });
  const totp = String(process.env.OAUTH_TOTP || "").trim();
  const scope = String(process.env.OAUTH_SCOPE || "").trim();
  if (totp) tokenParams.set("totp", totp);
  if (scope) tokenParams.set("scope", scope);

  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams,
  });
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenBody.access_token) {
    die(`OAuth login as ${identity} failed: HTTP ${tokenResponse.status}`);
  }
  account.token = tokenBody.access_token;
}

const authenticate = () => login("poller");

async function httpJson(method, url, body, identity = "poller") {
  let reloggedIn = false;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: headers(identity),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        // Long waits for votes outlive the OAuth token: log in again once.
        if ((res.status === 401 || res.status === 403) && IDENTITIES[identity]?.username && !reloggedIn) {
          reloggedIn = true;
          IDENTITIES[identity].token = "";
          await login(identity);
          continue;
        }
        throw new Error(`HTTP ${res.status} ${url}\n${text.slice(0, 500)}`);
      }
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

const POLLER_FUNCTIONS = ["batchHandleAction", "batchHandleTransfer"];

async function verifyAuthenticatedPoller() {
  const caller = await getAuthenticatedAddress();
  for (const func of POLLER_FUNCTIONS) {
    const rows = await cirrusGetAll("mapping", {
      address: `eq.${ADMIN_REGISTRY}`,
      collection_name: "eq.whitelist",
      "key->>key": `eq.${REWARDS}`,
      "key->>key2": `eq.${func}`,
      "key->>key3": `eq.${caller}`,
      select: "key,value::text",
    });
    const row = rows.find((entry) => plainKey(entry, 3));
    if (String(row?.value ?? "").replace(/^"|"$/g, "") !== "true") {
      die(`Authenticated poller ${caller} is not whitelisted for Rewards.${func}`);
    }
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

async function sendAndWait(txs, label, identity = "poller") {
  if (!IDENTITIES[identity].token) die(`${label}: authentication as ${identity} is required to send transactions`);
  console.log(`  -> posting ${txs.length} tx(s) as ${identity}: ${label}`);
  const response = await httpJson(
    "POST",
    `${NODE_URL}/strato/v2.3/transaction/parallel?resolve=true`,
    { txs, txParams: GAS },
    identity
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
    const results = await httpJson("POST", `${NODE_URL}/bloc/v2.2/transactions/results`, hashes, identity);
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

// Governance events emitted by one transaction: executed, pending, or none yet.
async function governanceOutcome(transactionHash) {
  const filter = {
    address: `eq.${ADMIN_REGISTRY}`,
    transaction_hash: `eq.${transactionHash}`,
    select: "issueId",
    limit: "1",
  };
  const [executed, created, voted] = await Promise.all([
    cirrusGet("BlockApps-AdminRegistry-IssueExecuted", filter),
    cirrusGet("BlockApps-AdminRegistry-IssueCreated", filter),
    cirrusGet("BlockApps-AdminRegistry-IssueVoted", filter),
  ]);
  const executedIssue = Array.isArray(executed) ? executed[0] : undefined;
  const pendingIssue =
    (Array.isArray(created) ? created[0] : undefined) ||
    (Array.isArray(voted) ? voted[0] : undefined);
  if (executedIssue) return { didExecute: true, issueId: executedIssue.issueId };
  if (pendingIssue) return { didExecute: false, issueId: pendingIssue.issueId };
  return null;
}

async function waitForGovernanceOutcome(transactionHash) {
  return waitForCirrus(async () => {
    const outcome = await governanceOutcome(transactionHash);
    return outcome
      ? { ok: true, ...outcome, detail: outcome.didExecute ? "IssueExecuted indexed" : "governance vote indexed" }
      : { ok: false, detail: "governance events not indexed yet" };
  }, `governance outcome for ${transactionHash}`);
}

// A governed call on an onlyOwner target. With admin credentials the call is
// submitted as the admin, which casts the first vote (the Ownable fallback
// routes it into AdminRegistry.castVoteOnIssue); then the on-chain effect is
// polled until the second admin's vote executes it, the way deploy/upgrade.js
// waits for IssueExecuted. Without admin credentials the call is announced
// for the admins to cast in SMD and the effect is polled the same way.
async function governedCall({ label, contractName, address, method, args, done }) {
  if (await done()) {
    console.log(`  ${label}: already in effect`);
    return;
  }
  const call = `${contractName}(${address}).${method}(${JSON.stringify(args)})`;
  if (IDENTITIES.admin.username) {
    await login("admin");
    const { hashes } = await sendAndWait([functionTx(contractName, address, method, args)], label, "admin");
    // A repeated vote by the same admin emits no governance event, so this
    // wait is bounded instead of fatal.
    let outcome = null;
    for (const deadline = Date.now() + 60000; !outcome && Date.now() < deadline; ) {
      outcome = await governanceOutcome(hashes[0]);
      if (!outcome) await sleep(CIRRUS_POLL_INTERVAL_MS);
    }
    if (outcome?.didExecute) {
      console.log(`  ${label}: executed (issue ${outcome.issueId})`);
    } else if (outcome) {
      console.log(`  ${label}: issue ${outcome.issueId} created by ${IDENTITIES.admin.username}; waiting for the second admin's vote`);
    } else {
      console.log(`  ${label}: no new vote recorded for ${call} (already voted?); waiting for it to execute`);
    }
  } else {
    console.log(`  ${label}: cast ${call} as two admins in SMD; waiting for it to execute`);
  }
  await waitForCirrus(
    async () => ({ ok: await done(), detail: "not executed yet" }),
    `${label} to execute`,
    VOTE_TIMEOUT_MS,
    VOTE_POLL_INTERVAL_MS
  );
  console.log(`  ${label}: in effect`);
}

async function submitPollerBatch(method, callArgs, label) {
  const { hashes } = await sendAndWait(
    [functionTx("Rewards", REWARDS, method, callArgs)],
    label
  );
  const transactionHash = hashes[0];
  const outcome = await waitForGovernanceOutcome(transactionHash);
  if (!outcome.didExecute) {
    die(`${label}: poller call unexpectedly created a pending governance issue`);
  }
  console.log(`\nPoller batch executed by ${await getAuthenticatedAddress()}`);
  console.log(`  transaction: ${transactionHash}`);
  return { didExecute: true, transactionHash };
}

// ---------------------------------------------------------------------------
// Chain state readers
// ---------------------------------------------------------------------------

// Cirrus splits some historical struct rows into per-field rows (key3 etc.);
// only rows keyed exactly as expected carry the live struct value. Each key
// part also comes with a `<part>_hex` companion, which is not a key part.
const plainKey = (row, depth) => {
  const keys = Object.keys(row.key || {}).filter((k) => !k.endsWith("_hex"));
  const expected = ["key", "key2", "key3"].slice(0, depth);
  return keys.length === depth && expected.every((k) => keys.includes(k));
};

const latestMappingRow = (rows) =>
  rows.reduce(
    (latest, row) =>
      !latest || chainUint(row.block_number) > chainUint(latest.block_number)
        ? row
        : latest,
    null
  );

async function getActivityConfig(activityId = ACTIVITY_ID) {
  const rows = await cirrusGetAll("mapping", {
    address: `eq.${REWARDS}`,
    collection_name: "eq.activities",
    "key->>key": `eq.${activityId}`,
    select: "key,value,block_number",
  });
  const main = latestMappingRow(rows.filter((row) => plainKey(row, 1)));
  if (!main) die(`Activity ${activityId} not found on Rewards ${REWARDS}`);
  const lengthRow = latestMappingRow(
    rows.filter(
      (row) => plainKey(row, 2) && row.key.key2 === "actionableEvents"
    )
  );
  if (!lengthRow) die(`Activity ${activityId} has no actionableEvents length`);
  const eventCount = Number(chainUint(lengthRow.value.length));
  const events = Array.from({ length: eventCount }, (_, index) => {
    const row = latestMappingRow(
      rows.filter(
        (candidate) =>
          plainKey(candidate, 3) &&
          candidate.key.key2 === "actionableEvents" &&
          String(candidate.key.key3) === String(index) &&
          chainUint(candidate.block_number) <= chainUint(lengthRow.block_number)
      )
    );
    if (!row) die(`Activity ${activityId} actionableEvents[${index}] is missing`);
    return {
      eventName: row.value.eventName,
      actionType: parseActionType(row.value.actionType),
    };
  });
  return {
    name: main.value.name,
    sourceContract: String(main.value.sourceContract).toLowerCase(),
    emissionRate: chainUint(main.value.emissionRate).toString(),
    activityType: parseActivityType(main.value.activityType),
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
  const isYield = VAULT_KIND === "yield";
  const table = isYield ? "BlockApps-YieldVault" : "BlockApps-SaveUSDSTVault";
  const rows = await cirrusGet(table, {
    address: `eq.${VAULT}`,
    select: isYield
      ? "_totalSupply::text,totalQueuedShares::text,_paused,queueHead::text,nextRequestId::text"
      : "_totalSupply::text,_paused",
  });
  if (!Array.isArray(rows) || !rows.length) die(`${table} ${VAULT} not found in Cirrus`);
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
  if (VAULT_KIND !== "yield") return {};
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

const normalizeAddress = (value) => String(value ?? "").toLowerCase().replace(/^0x/, "");

// Real vault events the poller has not applied: the activity's Deposit/Withdraw
// events (+ QueueProcessed on YieldVaults) and wallet-to-wallet share transfers.
// Mint/burn, custody, vault-self, self and zero-value transfers are never
// relayed, so they need no marker.
async function findUnprocessedVaultEvents() {
  const rows = await getVaultActionableEvents([...VAULT_ACTION_EVENTS, TRANSFER_EVENT]);
  const events = [];
  for (const row of rows) {
    const attributes =
      (typeof row.attributes === "string" ? JSON.parse(row.attributes) : row.attributes) || {};
    const event = {
      blockNumber: Number(row.block_number),
      eventIndex: Number(row.event_index),
      eventName: row.event_name,
      block_timestamp: row.block_timestamp,
    };
    if (row.event_name === TRANSFER_EVENT) {
      const sender = normalizeAddress(attributes.from);
      const recipient = normalizeAddress(attributes.to);
      if (
        !isUserHolder(sender) ||
        !isUserHolder(recipient) ||
        sender === recipient ||
        /^0*$/.test(String(attributes.value ?? "").trim())
      ) {
        continue;
      }
      Object.assign(event, { sender, recipient });
    } else {
      event.owner = normalizeAddress(attributes.owner);
    }
    events.push(event);
  }
  const processed = new Set(
    (await findProcessedPairs(events)).map((p) => `${p.blockNumber}:${p.eventIndex}`)
  );
  return events.filter((e) => !processed.has(`${e.blockNumber}:${e.eventIndex}`));
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

async function getActionFailuresForTransaction(transactionHash) {
  return cirrusGetAll("BlockApps-Rewards-ActionFailed", {
    address: `eq.${REWARDS}`,
    transaction_hash: `eq.${transactionHash}`,
    sourceContract: `eq.${VAULT}`,
    select: "sourceContract,user,eventName,blockNumber,eventIndex,reason",
  });
}

// ---------------------------------------------------------------------------
// Snapshot file handling
// ---------------------------------------------------------------------------

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    die(`Snapshot file ${SNAPSHOT_FILE} not found — run the snapshot phase first`);
  }
  const raw = fs.readFileSync(SNAPSHOT_FILE, "utf-8");
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  const expectedDigest = String(process.env.SNAPSHOT_SHA256 || "").toLowerCase();
  if (expectedDigest && digest !== expectedDigest) {
    die(`Snapshot SHA-256 mismatch: expected ${expectedDigest}, got ${digest}`);
  }
  console.log(`Snapshot SHA-256: ${digest}`);
  const snap = JSON.parse(raw);
  if (
    snap.network !== NETWORK ||
    snap.vaultKey !== VAULT_KEY ||
    snap.rewards !== REWARDS ||
    snap.vault !== VAULT ||
    String(snap.activityId) !== String(ACTIVITY_ID) ||
    snap.nodeUrl !== NODE_URL
  ) {
    die(
      `Snapshot file ${SNAPSHOT_FILE} was taken for a different target ` +
        `(network=${snap.network}, vaultKey=${snap.vaultKey}, rewards=${snap.rewards}, vault=${snap.vault}, ` +
        `activity=${snap.activityId}, node=${snap.nodeUrl})`
    );
  }
  if (!Number.isSafeInteger(snap.batchSize) || snap.batchSize < 1) {
    die(`Snapshot ${SNAPSHOT_FILE} has no valid batchSize — take a new snapshot`);
  }
  return snap;
}

async function requireReconciliationFrozen() {
  const [config, vault] = await Promise.all([getActivityConfig(), getVaultScalars()]);
  if (!vault.paused) die("Vault is not paused — refusing to reconcile mutable state");
  if (config.emissionRate !== "0") {
    die(`Emission rate is ${config.emissionRate}, not 0 — refusing to reconcile`);
  }
  return { config, vault };
}

async function requireAllProcessed(pairs, label) {
  if (!pairs.length) return;
  const processed = await findProcessedPairs(pairs);
  if (processed.length !== pairs.length) {
    die(`${label}: ${processed.length}/${pairs.length} expected event pairs are processed`);
  }
}

// Share holders that are user positions: not the vault itself (queued
// shares), not a native custody vault, not the zero address.
const isUserHolder = (holder) => holder !== VAULT && holder !== ZERO40 && !CUSTODY.has(holder);

// Shares that are not a user position: custody-vault holdings on every kind,
// plus the vault's own balance on a SaveUSDST vault (a YieldVault's self-balance
// is queued shares, re-attributed to their owners by computeTargets).
const nonPositionSupply = (balances) =>
  [...CUSTODY, ...(VAULT_KIND === "yield" ? [] : [VAULT])].reduce(
    (sum, holder) => sum + chainUint(balances[holder] || "0"),
    0n
  );

// Recompute what each user's stake SHOULD be: balance + queued shares.
function computeTargets(balances, queued) {
  const targets = {};
  for (const [holder, bal] of Object.entries(balances)) {
    if (!isUserHolder(holder)) continue;
    if (chainUint(bal) > 0n) targets[holder] = bal;
  }
  for (const [owner, shares] of Object.entries(queued)) {
    targets[owner] = (chainUint(targets[owner] || "0") + chainUint(shares)).toString();
  }
  return targets;
}

// ---------------------------------------------------------------------------
// batchHandleAction / batchHandleTransfer plumbing
// ---------------------------------------------------------------------------

function buildBatchArgs(method, batch) {
  const args = {
    sourceContracts: batch.map((a) => a.sourceContract),
    eventNames: batch.map((a) => a.eventName),
    amounts: batch.map((a) => a.amount),
    blockNumbers: batch.map((a) => a.blockNumber),
    eventIndexes: batch.map((a) => a.eventIndex),
  };
  if (method === "batchHandleTransfer") {
    args.senders = batch.map((a) => a.user);
    args.recipients = batch.map((a) => a.recipient);
  } else {
    args.users = batch.map((a) => a.user);
  }
  return args;
}

// Batches are contiguous and post through one contract method each (mirrors
// the poller's splitIntoBatches), so --batch N addresses a stable slice.
const splitBatches = (items, batchSize) => {
  const batches = [];
  for (const item of items) {
    const current = batches[batches.length - 1];
    if (current && current.length < batchSize && current[0].method === item.method) {
      current.push(item);
    } else {
      batches.push([item]);
    }
  }
  return batches;
};

function selectActionBatch(actions, batchSize, label, batchNumber) {
  const batches = splitBatches(actions, batchSize);
  if (!Number.isSafeInteger(batchNumber) || batchNumber < 1 || batchNumber > batches.length) {
    die(`${label}: --batch must be between 1 and ${batches.length}`);
  }
  return { batch: batches[batchNumber - 1], batchCount: batches.length };
}

function printActions(title, actions) {
  console.log(`\n${title} (${actions.length} actions):`);
  for (const a of actions) {
    console.log(
      `  ${a.eventName.padEnd(14)} user=${a.user}${a.recipient ? ` -> ${a.recipient}` : ""} ` +
        `amount=${fmt18(a.amount).padStart(28)} (block=${a.blockNumber}, idx=${a.eventIndex})`
    );
  }
}

async function executeActions(actions, batchSize, label, batchNumber) {
  const { batch, batchCount } = selectActionBatch(actions, batchSize, label, batchNumber);
  const method = batch[0].method || "batchHandleAction";
  console.log(`\nSelected ${label} batch ${batchNumber}/${batchCount} (${batch.length} actions via ${method})`);
  const { didExecute, transactionHash } = await submitPollerBatch(
    method,
    buildBatchArgs(method, batch),
    `${label} batch ${batchNumber}/${batchCount}`
  );
  if (!didExecute) return { didExecute: false, batch, batchCount };

  // Both batch functions swallow per-action failures and emit ActionFailed
  // instead. Scope the check to the exact execution transaction.
  const failures = await getActionFailuresForTransaction(transactionHash);
  if (failures.length) {
    console.error(`\nActionFailed events emitted during ${label}:`);
    for (const failure of failures) console.error(`  ${JSON.stringify(failure)}`);
    die(`${label}: ${failures.length} action(s) failed on-chain — investigate before continuing`);
  }
  return { didExecute: true, batch, batchCount };
}

async function waitForCirrus(
  check,
  description,
  timeoutMs = CIRRUS_POLL_TIMEOUT_MS,
  intervalMs = CIRRUS_POLL_INTERVAL_MS
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result.ok) return result;
    if (Date.now() > deadline) {
      die(`Timed out waiting for ${description}\nLast state: ${result.detail}`);
    }
    console.log(`  ... waiting for ${description}: ${result.detail}`);
    await sleep(intervalMs);
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
  if (config.emissionRate !== "0") {
    die(
      `Preflight blocked: ${VAULT_KEY} activity ${ACTIVITY_ID} emissionRate is ` +
        `${config.emissionRate}. Set it to 0 via Rewards.setEmissionRate in SMD first.`
    );
  }
  // Confirm the exact live poller identity is usable and whitelisted before
  // any reconciliation phase can send a transaction.
  await authenticate();
  const caller = await verifyAuthenticatedPoller();
  console.log(
    [
      "Preflight passed:",
      `  network:        ${NETWORK}`,
      `  vault profile:  ${VAULT_KEY}`,
      `  node:           ${NODE_URL}`,
      `  rewards:        ${REWARDS}`,
      `  vault:          ${VAULT}`,
      `  activity:       ${ACTIVITY_ID} (${config.name})`,
      `  activity type:  ${config.activityType}`,
      `  vault kind:     ${VAULT_KIND}`,
      `  custody:        ${[...CUSTODY].join(", ") || "none"}`,
      `  target events:  ${EXPECTED_POSITION_EVENTS}`,
      `  emission rate:  ${config.emissionRate}`,
      `  total stake:    ${state.totalStake}`,
      `  vault paused:   ${vault.paused}`,
      `  max batch size: ${rewardsScalars.maxBatchSize}`,
      `  poller:         ${caller}`,
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
  console.log(`  actionable events: ${config.actionableEvents.map((e) => `${e.eventName}->${ACTION_TYPE_NAMES[e.actionType]}`).join(", ")}`);
  console.log(`  emissionRate: ${config.emissionRate} (${fmt18(config.emissionRate)}/s)`);
  console.log(`  vault paused: ${vault.paused}  totalSupply: ${fmt18(vault.totalSupply)}  queued: ${fmt18(vault.totalQueuedShares)}`);
  console.log(`  activity totalStake: ${fmt18(state.totalStake)}`);
  console.log(`  non-position shares (custody/vault self): ${fmt18(nonPositionSupply(balances))}  target events: ${EXPECTED_POSITION_EVENTS}`);

  const targets = computeTargets(balances, queued);
  const { totalStake, totalTarget } = driftReport(stakes, targets);
  console.log(
    `\n  activityStates.totalStake = ${fmt18(state.totalStake)} | sum(stakes) = ${fmt18(totalStake)} | vault totalSupply = ${fmt18(vault.totalSupply)} | sum(targets) = ${fmt18(totalTarget)}`
  );
}

async function phaseSnapshot(restoreEmissionRate = process.env.RESTORE_EMISSION_RATE || "0") {
  console.log("Phase: snapshot");
  if (fs.existsSync(SNAPSHOT_FILE)) {
    die(`Snapshot ${SNAPSHOT_FILE} already exists — use it or remove it explicitly`);
  }
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
  if (!vault.paused) die("Vault is NOT paused. Pause it before taking the snapshot.");
  if (config.emissionRate !== "0") {
    die(
      `emissionRate is ${config.emissionRate} (${fmt18(config.emissionRate)}/s), not 0. ` +
        `Set it to 0 via Rewards.setEmissionRate in SMD before taking the snapshot.`
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
  if (VAULT_KIND === "yield") {
    const vaultSelf = chainUint(balances[VAULT] || "0");
    const sumQueued = Object.values(queued).reduce((a, v) => a + chainUint(v), 0n);
    if (vaultSelf !== chainUint(vault.totalQueuedShares) || sumQueued !== chainUint(vault.totalQueuedShares)) {
      die(
        `Queued-share accounting mismatch: vault self-balance=${vaultSelf}, ` +
          `sum(live request shares)=${sumQueued}, totalQueuedShares=${vault.totalQueuedShares}`
      );
    }
  }

  const targets = computeTargets(balances, queued);
  const sumTargets = Object.values(targets).reduce((a, v) => a + chainUint(v), 0n);
  const positionSupply = chainUint(vault.totalSupply) - nonPositionSupply(balances);
  if (sumTargets !== positionSupply) {
    die(`sum(targets) = ${sumTargets} != _totalSupply - non-position shares = ${positionSupply}`);
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
  const unprocessedReal = await findUnprocessedVaultEvents();
  console.log(`\nVault events not in processedEvents: ${unprocessedReal.length}`);
  if (unprocessedReal.length) {
    console.warn(
      `  NOTE: these were never applied by the poller (transfers emitted before the Transfer route existed,\n` +
        `  skipped batches, or events emitted after the poller stopped). Their effect is already inside the\n` +
        `  balance targets; the mark-historical phase will mark them processed so nothing replays them.`
    );
    for (const p of unprocessedReal) {
      console.warn(`    ${p.eventName} block=${p.blockNumber} idx=${p.eventIndex} at ${p.block_timestamp}`);
    }
  }

  const snapshot = {
    takenAt: new Date().toISOString(),
    network: NETWORK,
    vaultKey: VAULT_KEY,
    nodeUrl: NODE_URL,
    rewards: REWARDS,
    vault: VAULT,
    activityId: String(ACTIVITY_ID),
    restoreEmissionRate: chainUint(restoreEmissionRate).toString(),
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
    unprocessedRealEvents: unprocessedReal.map(({ block_timestamp, ...event }) => event),
  };
  const serializedSnapshot = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(SNAPSHOT_FILE, serializedSnapshot);
  console.log(`\nSnapshot written to ${SNAPSHOT_FILE}`);
  console.log(
    `Snapshot SHA-256: ${crypto.createHash("sha256").update(serializedSnapshot).digest("hex")}\n` +
      "Share this exact snapshot file and hash with every script operator."
  );

  const { totalStake, totalTarget } = driftReport(stakes, targets);
  console.log(`\nPlan:`);
  console.log(`  1. withdraw:        ${withdrawUsers.length} synthetic Withdraw actions (zero all stakes; settles earned rewards)`);
  console.log(`  2. SMD:             setPositionActivityEvents -> ${EXPECTED_POSITION_EVENTS}`);
  console.log(`  3. mark-historical: mark ${unprocessedReal.length} real event(s) processed with zero-amount synthetics`);
  console.log(`  4. seed:            ${seedUsers.length} synthetic Deposit actions (target total ${fmt18(totalTarget)})`);
  console.log(`  5. verify:          totalStake == totalSupply - non-position shares == ${fmt18(positionSupply)}`);
  console.log(`  aggregate drift being corrected: ${fmt18(totalStake - totalTarget)}`);
}

async function phaseWithdraw(batchNumber = BATCH_NUMBER) {
  console.log("Phase: withdraw (zero out all tracked stakes)");
  const snap = loadSnapshot();
  await requireReconciliationFrozen();

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
    return 0;
  }
  const selected = selectActionBatch(actions, snap.batchSize, "withdraw", batchNumber);

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
    console.log(`Withdraw batch ${batchNumber}/${selected.batchCount} is already complete.`);
    return selected.batchCount;
  }
  printActions(
    `Synthetic Withdraw batch ${batchNumber}/${selected.batchCount}`,
    selected.batch
  );

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return selected.batchCount;
  }
  const result = await executeActions(actions, snap.batchSize, "withdraw", batchNumber);
  if (!result.didExecute) return result.batchCount;

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
      `\nOK: withdraw batch ${batchNumber}/${result.batchCount} executed. ` +
        `Remaining totalStake: ${fmt18(state.totalStake)}. Execute the next batch.`
    );
  }
  return result.batchCount;
}

async function phaseMarkHistorical(batchNumber = BATCH_NUMBER) {
  console.log("Phase: mark-historical (idempotency-mark unprocessed real vault events)");
  const snap = loadSnapshot();

  const [{ config }, state] = await Promise.all([
    requireReconciliationFrozen(),
    getActivityState(),
  ]);
  if (chainUint(state.totalStake) !== 0n) {
    die(`totalStake is ${state.totalStake}, not 0 — run every withdraw batch first`);
  }
  await requireAllProcessed(snap.withdrawPairs, "Withdraw phase is incomplete");
  const eventSignature = actionableEventsSignature(config);
  if (eventSignature !== EXPECTED_POSITION_EVENTS) {
    die(
      `Actionable events are [${eventSignature}], not [${EXPECTED_POSITION_EVENTS}] — ` +
        "correct setPositionActivityEvents in SMD before marking historical events"
    );
  }

  const historical = snap.unprocessedRealEvents || [];
  if (!historical.length) {
    console.log("All real vault events are already marked processed — nothing to do.");
    return 0;
  }

  // amount = 0: _handleAction / _handleTransfer mark the (block,index) hash
  // processed and return before touching any stake, so this cannot change
  // positions or rewards. Actions first, then transfers (batchHandleTransfer).
  const actions = historical
    .map((p) =>
      p.eventName === TRANSFER_EVENT
        ? {
            method: "batchHandleTransfer",
            sourceContract: VAULT,
            eventName: p.eventName,
            user: p.sender,
            recipient: p.recipient,
            amount: "0",
            blockNumber: p.blockNumber,
            eventIndex: p.eventIndex,
          }
        : {
            method: "batchHandleAction",
            sourceContract: VAULT,
            eventName: p.eventName,
            user: String(p.owner || "").toLowerCase() || VAULT,
            amount: "0",
            blockNumber: p.blockNumber,
            eventIndex: p.eventIndex,
          }
    )
    .sort((a, b) => a.method.localeCompare(b.method));
  const selected = selectActionBatch(actions, snap.batchSize, "mark-historical", batchNumber);
  const alreadyProcessed = await findProcessedPairs(selected.batch);
  if (alreadyProcessed.length === selected.batch.length) {
    console.log(
      `Historical marker batch ${batchNumber}/${selected.batchCount} is already complete.`
    );
    return selected.batchCount;
  }
  if (alreadyProcessed.length) {
    die(`Historical marker batch ${batchNumber} is only partially processed — investigate`);
  }
  printActions(
    `Zero-amount marker batch ${batchNumber}/${selected.batchCount}`,
    selected.batch
  );

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return selected.batchCount;
  }
  const result = await executeActions(actions, snap.batchSize, "mark-historical", batchNumber);
  if (!result.didExecute) return result.batchCount;

  await waitForCirrus(async () => {
    const nowProcessed = await findProcessedPairs(result.batch);
    return {
      ok: nowProcessed.length === result.batch.length,
      detail: `${nowProcessed.length}/${result.batch.length} marked`,
    };
  }, "selected historical event batch marked processed");
  console.log(
    `\nOK: historical marker batch ${batchNumber}/${result.batchCount} is complete.`
  );

  // stakes must be untouched by this phase
  const finalState = await getActivityState();
  if (chainUint(finalState.totalStake) !== 0n) {
    die(`totalStake changed to ${finalState.totalStake} during mark-historical — investigate immediately`);
  }
  return result.batchCount;
}

async function phaseSeed(batchNumber = BATCH_NUMBER) {
  console.log("Phase: seed (re-create correct positions)");
  const snap = loadSnapshot();

  const { config } = await requireReconciliationFrozen();
  const eventSignature = actionableEventsSignature(config);
  if (eventSignature !== EXPECTED_POSITION_EVENTS) {
    die(
      `Actionable events are [${eventSignature}], not [${EXPECTED_POSITION_EVENTS}] — ` +
        "correct setPositionActivityEvents in SMD before seed"
    );
  }
  await requireAllProcessed(snap.withdrawPairs, "Withdraw phase is incomplete");
  await requireAllProcessed(
    snap.unprocessedRealEvents || [],
    "Historical marker phase is incomplete"
  );

  // Freshness check: carryETH transfers are NOT blocked by pause, so balances
  // can have moved since snapshot. Refuse to seed stale targets.
  const [balances, queued, vault] = await Promise.all([
    getBalances(),
    getQueuedSharesByOwner(),
    getVaultScalars(),
  ]);
  const liveTargets = computeTargets(balances, queued);
  const targets = snap.targets;
  const changed = [...new Set([...Object.keys(liveTargets), ...Object.keys(snap.targets)])].filter(
    (u) => chainUint(liveTargets[u] || "0") !== chainUint(snap.targets[u] || "0")
  );
  if (changed.length) {
    die(
      `Balances moved since snapshot for: ${changed.join(", ")}.\n` +
        `Re-run snapshot so every admin votes on the same immutable seed payload.`
    );
  }

  const seedPairByUser = new Map(snap.seedPairs.map((pair) => [pair.user, pair]));

  const actions = Object.entries(targets)
    .filter(([, t]) => chainUint(t) > 0n)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([user, amount]) => {
      const pair = seedPairByUser.get(user);
      if (!pair) die(`Snapshot has no reserved seed pair for ${user}`);
      return {
        sourceContract: VAULT,
        eventName: "Deposit",
        user,
        amount,
        blockNumber: pair.blockNumber,
        eventIndex: pair.eventIndex,
      };
    });

  if (!actions.length) die("No targets to seed — is the vault empty?");
  const selected = selectActionBatch(actions, snap.batchSize, "seed", batchNumber);
  const [liveStakes, activityState, processedSeeds] = await Promise.all([
    getStakes(),
    getActivityState(),
    findProcessedPairs(actions),
  ]);
  const processedSeedKeys = new Set(
    processedSeeds.map((pair) => `${pair.blockNumber}:${pair.eventIndex}`)
  );
  const summedStake = Object.values(liveStakes).reduce(
    (sum, stake) => sum + chainUint(stake),
    0n
  );
  if (summedStake !== chainUint(activityState.totalStake)) {
    die(`sum(stakes)=${summedStake} does not match totalStake=${activityState.totalStake}`);
  }
  for (const [user, stake] of Object.entries(liveStakes)) {
    const live = chainUint(stake);
    const target = chainUint(targets[user] || "0");
    if (target === 0n && live !== 0n) {
      die(`Unexpected non-zero stake for ${user}: ${live}`);
    }
  }
  for (const action of actions) {
    const processed = processedSeedKeys.has(`${action.blockNumber}:${action.eventIndex}`);
    const live = chainUint(liveStakes[action.user] || "0");
    const expected = processed ? chainUint(action.amount) : 0n;
    if (live !== expected) {
      die(
        `Seed state mismatch for ${action.user}: pair is ${processed ? "" : "not "}processed, ` +
          `stake=${live}, expected=${expected}`
      );
    }
  }
  const selectedProcessed = selected.batch.filter((action) =>
    processedSeedKeys.has(`${action.blockNumber}:${action.eventIndex}`)
  );
  if (selectedProcessed.length === selected.batch.length) {
    console.log(`Seed batch ${batchNumber}/${selected.batchCount} is already complete.`);
    return selected.batchCount;
  }
  if (selectedProcessed.length) {
    die(`Seed batch ${batchNumber} is only partially processed — investigate`);
  }
  printActions(`Synthetic Deposit batch ${batchNumber}/${selected.batchCount}`, selected.batch);
  const total = actions.reduce((a, x) => a + chainUint(x.amount), 0n);
  const positionSupply = chainUint(vault.totalSupply) - nonPositionSupply(balances);
  console.log(`\n  target total: ${fmt18(total)} | vault totalSupply - non-position shares: ${fmt18(positionSupply)}`);
  if (total !== positionSupply) {
    die("Seed total != live vault totalSupply - non-position shares — refusing to proceed");
  }

  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to send).");
    return selected.batchCount;
  }
  const result = await executeActions(actions, snap.batchSize, "seed", batchNumber);
  if (!result.didExecute) return result.batchCount;

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
    console.log(`\nOK: all positions seeded; totalStake == ${fmt18(total)} == totalSupply - non-position shares.`);
  } else {
    console.log(
      `\nOK: seed batch ${batchNumber}/${result.batchCount} executed. ` +
        `Current totalStake: ${fmt18(state.totalStake)}. Execute the next batch.`
    );
  }
  return result.batchCount;
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
  const eventNames = actionableEventsSignature(config);
  const totalStake = Object.values(stakes).reduce(
    (sum, stake) => sum + chainUint(stake),
    0n
  );
  const totalTarget = Object.values(targets).reduce(
    (sum, target) => sum + chainUint(target),
    0n
  );
  const perUserMatches =
    Object.keys(targets).every(
      (user) => chainUint(stakes[user] || "0") === chainUint(targets[user])
    ) &&
    Object.keys(stakes).every(
      (user) => chainUint(stakes[user]) === chainUint(targets[user] || "0")
    );
  driftReport(stakes, targets);

  const positionSupply = chainUint(vault.totalSupply) - nonPositionSupply(balances);
  const checks = [
    [`actionable events = ${EXPECTED_POSITION_EVENTS}`, eventNames === EXPECTED_POSITION_EVENTS, eventNames],
    ["sum(stakes) == activityStates.totalStake", totalStake === chainUint(state.totalStake), `${totalStake} vs ${state.totalStake}`],
    ["totalStake == vault totalSupply - non-position shares", chainUint(state.totalStake) === positionSupply, `${state.totalStake} vs ${positionSupply}`],
    ["per-user stake == balance + queued", perUserMatches, `${fmt18(totalStake - totalTarget)} residual drift`],
    ["emission rate is zero while the vault is paused", !vault.paused || chainUint(config.emissionRate) === 0n, config.emissionRate],
  ];

  // Drain check: every vault event up to the snapshot block must be marked
  // processed (the seed already reflects it); anything newer is left for the
  // poller to relay after restart.
  if (fs.existsSync(SNAPSHOT_FILE)) {
    const snap = loadSnapshot();
    const unprocessed = await findUnprocessedVaultEvents();
    const stale = unprocessed.filter((e) => e.blockNumber <= snap.snapshotBlock);
    checks.push([
      `no unprocessed vault events at or before snapshot block ${snap.snapshotBlock}`,
      stale.length === 0,
      stale.map((e) => `${e.eventName}(${e.blockNumber},${e.eventIndex})`).join(", "),
    ]);
    const pending = unprocessed.length - stale.length;
    if (pending) {
      console.log(`\n  note: ${pending} vault event(s) newer than the snapshot are unprocessed; the poller relays them after restart`);
    }
  }

  console.log("");
  let allOk = true;
  for (const [name, ok, detail] of checks) {
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : `  (${detail})`}`);
    if (!ok) allOk = false;
  }
  if (!allOk) die("Verification FAILED");
  console.log(`\nAll checks passed. Activity ${ACTIVITY_ID} totalStake = ${fmt18(state.totalStake)} = vault totalSupply - non-position shares.`);
  console.log(
    vault.paused
      ? `Activity ${ACTIVITY_ID} is reconciled: unpause the vault and restore its emission rate in SMD.`
      : `Activity ${ACTIVITY_ID} is reconciled and live (emission rate ${config.emissionRate}).`
  );
}

async function phaseRun() {
  console.log("Phase: run (freeze -> reconcile -> opt in -> unfreeze)");
  const [config, state, vault] = await Promise.all([getActivityConfig(), getActivityState(), getVaultScalars()]);
  if (config.sourceContract !== VAULT) {
    die(`Activity ${ACTIVITY_ID} sourceContract is ${config.sourceContract}, not ${VAULT}`);
  }
  const hasSnapshot = fs.existsSync(SNAPSHOT_FILE);
  // The rate to restore: what is live now, or what the snapshot recorded when
  // this run froze it earlier. Never guess from history: some activities are
  // meant to stay at zero.
  let restoreEmissionRate = process.env.RESTORE_EMISSION_RATE;
  if (restoreEmissionRate === undefined) {
    if (config.emissionRate !== "0") restoreEmissionRate = config.emissionRate;
    else if (hasSnapshot) restoreEmissionRate = loadSnapshot().restoreEmissionRate;
    else die("Emission is already 0 and no snapshot exists: set RESTORE_EMISSION_RATE (0 keeps it off)");
  }
  restoreEmissionRate = chainUint(restoreEmissionRate).toString();
  const governance = IDENTITIES.admin.username
    ? `first vote cast as ${IDENTITIES.admin.username}, then waits for the second admin`
    : "announced for two admins to cast in SMD, then waits";
  console.log(
    [
      "",
      `  activity:        ${ACTIVITY_ID} (${config.name}) events ${actionableEventsSignature(config)} -> ${EXPECTED_POSITION_EVENTS}`,
      `  emission:        ${config.emissionRate} now, ${restoreEmissionRate} after`,
      `  vault paused:    ${vault.paused}  totalStake: ${fmt18(state.totalStake)}`,
      `  snapshot:        ${hasSnapshot ? `reuse ${SNAPSHOT_FILE}` : `write ${SNAPSHOT_FILE}`}`,
      `  governed calls:  ${governance}`,
    ].join("\n")
  );
  if (!EXECUTE) {
    console.log("\nDry run (pass --execute to run every step above).");
    return;
  }

  const rewardsCall = (method, args) => ({ contractName: "Rewards", address: REWARDS, method, args });
  const vaultCall = (method) => ({ contractName: VAULT_CONTRACT_NAME, address: VAULT, method, args: {} });
  const emissionIs = (rate) => async () => (await getActivityConfig()).emissionRate === rate;
  const pausedIs = (paused) => async () => (await getVaultScalars()).paused === paused;
  const runBatches = async (phase) => {
    for (let batchNumber = 1; ; batchNumber++) {
      const batchCount = await phase(batchNumber);
      if (!batchCount || batchNumber >= batchCount) return;
    }
  };

  console.log("\n== freeze");
  await governedCall({ label: "setEmissionRate(0)", ...rewardsCall("setEmissionRate", { activityId: Number(ACTIVITY_ID), newEmissionRate: "0" }), done: emissionIs("0") });
  await governedCall({ label: "pause()", ...vaultCall("pause"), done: pausedIs(true) });

  console.log("\n== snapshot");
  if (hasSnapshot) {
    loadSnapshot();
    console.log(`Reusing ${SNAPSHOT_FILE}`);
  } else {
    await phaseSnapshot(restoreEmissionRate);
  }

  console.log("\n== withdraw");
  await runBatches(phaseWithdraw);

  console.log("\n== opt in");
  await governedCall({
    label: "setPositionActivityEvents",
    ...rewardsCall("setPositionActivityEvents", { activityId: Number(ACTIVITY_ID), newActionableEvents: expectedEventsArgs() }),
    done: async () => actionableEventsSignature(await getActivityConfig()) === EXPECTED_POSITION_EVENTS,
  });

  console.log("\n== mark-historical");
  await runBatches(phaseMarkHistorical);
  console.log("\n== seed");
  await runBatches(phaseSeed);
  console.log("\n== verify");
  await phaseVerify();

  console.log("\n== unfreeze");
  await governedCall({ label: "unpause()", ...vaultCall("unpause"), done: pausedIs(false) });
  if (chainUint(restoreEmissionRate) > 0n) {
    await governedCall({
      label: `setEmissionRate(${restoreEmissionRate})`,
      ...rewardsCall("setEmissionRate", { activityId: Number(ACTIVITY_ID), newEmissionRate: restoreEmissionRate }),
      done: emissionIs(restoreEmissionRate),
    });
  }
  console.log(`\nDone: activity ${ACTIVITY_ID} reconciled and live again. Restart the rewards poller.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  if (!PROFILE) die("NETWORK or --network must be testnet or prod");
  if (!VAULT_PROFILE) die(`VAULT or --vault must be one of: ${Object.keys(PROFILE.vaults).join(", ")}`);
  if (!["yield", "save"].includes(VAULT_KIND)) die("VAULT_KIND must be yield or save");
  if (!NODE_URL) die("NODE_URL env var required");
  if (!REWARDS || REWARDS.length !== 40) die("REWARDS_ADDRESS env var required (40 hex chars, no 0x)");
  if (!VAULT || VAULT.length !== 40) die("VAULT_ADDRESS env var required (40 hex chars, no 0x)");
  if (!ACTIVITY_ID || !/^\d+$/.test(ACTIVITY_ID)) die("ACTIVITY_ID env var required (integer)");
  if (!Number.isSafeInteger(BATCH_SIZE_ENV) || BATCH_SIZE_ENV < 1) die("BATCH_SIZE must be a positive integer");
  if (!Number.isSafeInteger(BATCH_NUMBER) || BATCH_NUMBER < 1) die("--batch must be a positive integer");

  const phases = {
    run: phaseRun,
    preflight: phasePreflight,
    status: phaseStatus,
    snapshot: phaseSnapshot,
    withdraw: phaseWithdraw,
    "mark-historical": phaseMarkHistorical,
    seed: phaseSeed,
    verify: phaseVerify,
  };

  if (!phase || !phases[phase]) {
    console.error(
      `Usage: node ${path.basename(__filename)} <${Object.keys(phases).join("|")}> ` +
        `--network <testnet|prod> --vault <${Object.keys(PROFILE.vaults).join("|")}> ` +
        `[--execute] [--confirm-prod] [--batch <number>] ` +
        `[--confirm-poller-stopped]`
    );
    process.exit(1);
  }

  if (POLLER_STOPPED_PHASES.has(phase) && !CONFIRM_POLLER_STOPPED) {
    die(
      `${phase} requires --confirm-poller-stopped after the rewards poller is stopped ` +
        `and all in-flight batches have drained`
    );
  }

  if (EXECUTE) {
    if ((RESOLVES_TO_PROD || HAS_TARGET_OVERRIDE) && !CONFIRM_PROD) {
      die("Production or overridden target execution requires --confirm-prod");
    }
    await authenticate();
    const caller = await verifyAuthenticatedPoller();
    const config = await getActivityConfig();
    if (config.sourceContract !== VAULT) {
      die(`Activity ${ACTIVITY_ID} sourceContract is ${config.sourceContract}, not ${VAULT}`);
    }
    console.log(`authenticated poller=${caller}`);
  }

  console.log(
    `network=${NETWORK}\nvaultProfile=${VAULT_KEY}\nnode=${NODE_URL}\nrewards=${REWARDS}\n` +
      `vault=${VAULT}\nactivity=${ACTIVITY_ID}\n` +
      `mode=${EXECUTE ? "EXECUTE" : "dry-run"}\n`
  );
  await phases[phase]();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
