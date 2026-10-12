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

function getClient() {
  if (clientPromise) return clientPromise;

  const host = process.env.redis_host || "redis";
  const port = parseInt(process.env.redis_port || "6379", 10);

  const client = createClient({
    socket: { host, port },
  });

  client.on("error", (err) => {
    winston.warn(`Redis client error: ${err.message}`);
  });

  clientPromise = client.connect().then(() => client).catch((err) => {
    // Reset so subsequent calls retry the connection.
    clientPromise = null;
    throw err;
  });

  return clientPromise;
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
  const client = await getClient();
  const buf = await client.get(commandOptions({ returnBuffers: true }), BEST_BLOCK_KEY);
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
  const client = await getClient();
  const buf = await client.get(commandOptions({ returnBuffers: true }), PARENT_KEY_PREFIX + hash);
  if (!buf) return null;
  return Buffer.from(RLP.decode(buf)).toString("hex").padStart(64, "0");
}

// Returns the node's sync status from Redis (true, false), or null when the
// node has not written one yet.
async function getSyncStatus() {
  const client = await getClient();
  const buf = await client.get(commandOptions({ returnBuffers: true }), SYNC_STATUS_KEY);
  if (!buf) return null;
  // RLP of a Bool: a single 0x01 byte for True, the empty string for False.
  return Buffer.from(RLP.decode(buf)).length > 0;
}

// Returns the current validator list stored in Redis by strato (the same
// source that /eth/v1.2/metadata reads via `getBestSequencedBlockInfo`).
// Each validator is returned as a 40-char lowercase hex address without a
// 0x prefix, matching the metadata endpoint's JSON format.
async function getValidators() {
  const client = await getClient();
  const buf = await client.get(commandOptions({ returnBuffers: true }), BEST_SEQUENCED_BLOCK_KEY);
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
