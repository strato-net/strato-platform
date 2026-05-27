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

// Returns the bestBlockNumber stored in Redis by strato (the same source that
// `strato-barometer syncstats` reads via `getBestBlockInfo`).
async function getBestBlockNumber() {
  const client = await getClient();
  const buf = await client.get(commandOptions({ returnBuffers: true }), BEST_BLOCK_KEY);
  if (!buf) return null;

  const decoded = RLP.decode(buf);
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error("Unexpected RLP shape for BestBlock value in Redis");
  }
  // decoded[0] is the 32-byte hash, decoded[1] is the big-endian number bytes.
  const numberBytes = Buffer.from(decoded[1]);
  return numberBytes.length === 0 ? 0 : Number(BigInt("0x" + numberBytes.toString("hex")));
}

module.exports = {
  getBestBlockNumber,
};
