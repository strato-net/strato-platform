const { createClient, commandOptions } = require("redis");
const RLP = require("rlp");
const winston = require("winston-color");

// Matches `bestBlockInfoKey = "<best>"` in strato/core/blockDB/src/Blockchain/SyncDB.hs.
// The value is stored via `toValue = rlpSerialize . rlpEncode` (see
// strato/core/strato-redis-blockdb/src/Blockchain/Strato/RedisBlockDB/Models.hs),
// producing an RLP-encoded array of [hash, number] for the BestBlock type defined
// in strato/core/blockDB/src/Blockchain/Model/SyncState.hs. This is the same value
// read by `strato-barometer syncstats` (via `getBestBlockInfo`).
const BEST_BLOCK_KEY = "<best>";

// Matches `bestSequencedBlockInfoKey = "<best_sequenced>"` in
// strato/core/blockDB/src/Blockchain/SyncDB.hs. The value is an RLP-encoded
// array of [hash, number, validators] for the BestSequencedBlock type defined
// in strato/core/blockDB/src/Blockchain/Model/SyncState.hs, where validators
// is a list of 20-byte addresses. This is the same value read by the
// /eth/v1.2/metadata endpoint (via `getBestSequencedBlockInfo`).
const BEST_SEQUENCED_BLOCK_KEY = "<best_sequenced>";

let clientPromise = null;

// `redis_host=none` says this apex has no Redis block cache at all: an API
// tier task, where Redis lives on the core cells and is not published. The
// entrypoint leaves an explicit redis_host alone, so this is the operator's
// word. Nothing is connected and every reader rejects at once, so the
// callers' SQL fallbacks answer without first waiting out REDIS_TIMEOUT_MS
// on every request.
const NO_REDIS = (process.env.redis_host || "").trim().toLowerCase() === "none";
let noRedisLogged = false;

// After a failed connect, how long readers reject at once instead of each
// paying REDIS_TIMEOUT_MS again for a Redis that is away (restarting, or not
// where the configuration says). The first call after that tries again.
const RETRY_CONNECT_AFTER_MS = 30 * 1000;
let retryConnectAt = 0;

// How long a Redis call may take before apex gives up on the block cache and
// reads SQL instead. Left to its defaults, node-redis retries a failed
// connection for ever (connect() never rejects) and parks commands in an
// offline queue while Redis is away, which would hang /health and /status
// rather than let them fall back.
const REDIS_TIMEOUT_MS = 2000;

function withTimeout(promise, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis ${what} timed out after ${REDIS_TIMEOUT_MS} ms`)),
      REDIS_TIMEOUT_MS
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function getClient() {
  if (NO_REDIS) {
    if (!noRedisLogged) {
      noRedisLogged = true;
      winston.info("redis_host=none: no Redis block cache here, the last block and validators are read from SQL");
    }
    return Promise.reject(new Error("no Redis block cache here (redis_host=none)"));
  }
  if (clientPromise) return clientPromise;
  const waitMs = retryConnectAt - Date.now();
  if (waitMs > 0) {
    return Promise.reject(
      new Error(`Redis connect failed recently, not retried for another ${Math.ceil(waitMs / 1000)} s`)
    );
  }

  const host = process.env.redis_host || "redis";
  const port = parseInt(process.env.redis_port || "6379", 10);
  // The database the node's processes use (--redisDBNumber, from ethconf).
  const database = parseInt(process.env.redis_db_number, 10);

  const client = createClient({
    database: Number.isFinite(database) ? database : 0,
    socket: {
      host,
      port,
      connectTimeout: REDIS_TIMEOUT_MS,
      // Keep reconnecting in the background once Redis has been seen, so the
      // cache comes back by itself; commands issued meanwhile fail at once
      // (no offline queue) and the callers read SQL.
      reconnectStrategy: (retries) => Math.min(retries * 100, 1000),
    },
    disableOfflineQueue: true,
  });

  client.on("error", (err) => {
    winston.warn(`Redis client error: ${err.message}`);
  });

  const connecting = withTimeout(client.connect(), "connect")
    .then(() => {
      retryConnectAt = 0;
      return client;
    })
    .catch((err) => {
      // Stop the client's own retry loop. Calls in the next
      // RETRY_CONNECT_AFTER_MS fail at once; the first one after it starts afresh.
      retryConnectAt = Date.now() + RETRY_CONNECT_AFTER_MS;
      if (clientPromise === connecting) clientPromise = null;
      client.disconnect().catch(() => {});
      throw err;
    });
  client.on("end", () => {
    if (clientPromise === connecting) clientPromise = null;
  });

  clientPromise = connecting;
  return connecting;
}

// GET a key as a Buffer, or null when it is absent; rejects within
// REDIS_TIMEOUT_MS when Redis cannot answer.
async function redisGet(key) {
  const client = await getClient();
  return withTimeout(client.get(commandOptions({ returnBuffers: true }), key), `GET ${key}`);
}

// Matches `syncStatusKey = "<sync_status>"` in SyncDB.hs: the node's own
// sync verdict (the one /eth/v1.2/metadata reports as isSynced), stored as an
// RLP-encoded Bool.
const SYNC_STATUS_KEY = "<sync_status>";

// Matches the Parent namespace ("p:" ++ hex hash) in
// strato/core/blockDB/src/Blockchain/BlockDB.hs: the parent hash of every
// block strato-indexer put in Redis, RLP-encoded.
const PARENT_KEY_PREFIX = "p:";

function rlpNumber(bytes) {
  const buf = Buffer.from(bytes);
  return buf.length === 0 ? 0 : Number(BigInt("0x" + buf.toString("hex")));
}

// Returns the best block stored in Redis by strato (the same source that
// `strato-barometer syncstats` reads via `getBestBlockInfo`) as
// { number, hash }, the hash as 64 hex chars without a 0x prefix like the
// block_data_ref.hash column, or null when Redis has no best block yet.
async function getBestBlock() {
  const buf = await redisGet(BEST_BLOCK_KEY);
  if (!buf) return null;

  const decoded = RLP.decode(buf);
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error("Unexpected RLP shape for BestBlock value in Redis");
  }
  // decoded[0] is the 32-byte hash, decoded[1] is the big-endian number bytes.
  return {
    number: rlpNumber(decoded[1]),
    hash: Buffer.from(decoded[0]).toString("hex").padStart(64, "0"),
  };
}

async function getBestBlockNumber() {
  const best = await getBestBlock();
  return best ? best.number : null;
}

// Returns the parent hash of the block with the given hex hash, or null when
// Redis does not hold that block.
async function getParentHash(hash) {
  const buf = await redisGet(PARENT_KEY_PREFIX + hash);
  if (!buf) return null;
  return Buffer.from(RLP.decode(buf)).toString("hex").padStart(64, "0");
}

// Returns the node's sync status from Redis (true, false), or null when the
// node has not written one yet.
async function getSyncStatus() {
  const buf = await redisGet(SYNC_STATUS_KEY);
  if (!buf) return null;
  // The flag is one RLP byte: 0x01 for True, 0x00 for False (seen on a node
  // syncing from genesis; an empty value would also mean False).
  const bytes = Buffer.from(RLP.decode(buf));
  return bytes.length > 0 && bytes[0] !== 0;
}

// Returns the current validator list stored in Redis by strato (the same
// source that /eth/v1.2/metadata reads via `getBestSequencedBlockInfo`).
// Each validator is returned as a 40-char lowercase hex address without a
// 0x prefix, matching the metadata endpoint's JSON format.
async function getValidators() {
  const buf = await redisGet(BEST_SEQUENCED_BLOCK_KEY);
  if (!buf) return null;

  const decoded = RLP.decode(buf);
  if (!Array.isArray(decoded) || decoded.length < 3 || !Array.isArray(decoded[2])) {
    throw new Error("Unexpected RLP shape for BestSequencedBlock value in Redis");
  }
  // Addresses are fixed 20-byte buffers; padStart guards against any
  // leading-zero-stripped encoding, matching Haskell's `%040x` formatting.
  return decoded[2].map((addr) => Buffer.from(addr).toString("hex").padStart(40, "0"));
}

module.exports = {
  getBestBlock,
  getBestBlockNumber,
  getParentHash,
  getSyncStatus,
  getValidators,
};
