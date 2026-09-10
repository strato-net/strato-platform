// Reads the node's sync scalars from the `node_status` table in the eth
// database. The core mirrors these from Redis (see
// strato/core/blockDB/src/Blockchain/NodeStatusMirror.hs) so that nothing
// outside the core needs a Redis connection; the key names and JSON shapes
// are defined in strato/core/blockDB/src/Blockchain/Data/NodeStatus.hs.
const db = require("../models/strato/eth/connection");

async function getValue(name) {
  const rows = await db.sequelize.query(
    "SELECT value FROM node_status WHERE name = :name",
    { replacements: { name }, type: db.Sequelize.QueryTypes.SELECT }
  );
  if (!rows.length) return null;
  return JSON.parse(rows[0].value);
}

// Returns the bestBlockNumber the node has applied (the same value
// `strato-barometer syncstats` reads from Redis), or null if the mirror has
// not written yet.
async function getBestBlockNumber() {
  const best = await getValue("best_block");
  return best ? Number(best.number) : null;
}

// Returns the current validator list as 40-char lowercase hex addresses,
// matching the /eth/v1.2/metadata endpoint, or null if not yet mirrored.
async function getValidators() {
  const sequenced = await getValue("best_sequenced_block");
  if (!sequenced || !Array.isArray(sequenced.validators)) return null;
  return sequenced.validators.map((addr) => String(addr).toLowerCase().replace(/^0x/, "").padStart(40, "0"));
}

module.exports = {
  getBestBlockNumber,
  getValidators,
};
