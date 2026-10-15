const winston = require("winston-color");
const db = require("../../models/strato/eth/connection");

// Whether this node keeps the SQL block index (block_data_ref, raw_transaction,
// address_state_ref and friends). A lite validator (strato-indexer --sql=false)
// does not, and the SMD pollers that read it would otherwise fail every second
// for good, filling the log as they go. Probed once: the answer does not change
// while the node runs.
let probe = null;

function hasBlockIndex() {
  if (!probe) {
    // One probe shared by every poller that asks before it resolves. A failed
    // probe (the database not up yet) answers false and is forgotten so the
    // next poll retries; it never rejects, because the pollers run from
    // setInterval, where a rejection is unhandled and ends the process.
    probe = db.sequelize
      .query("SELECT to_regclass('public.block_data_ref') AS t")
      .then(([[row]]) => {
        const known = row.t !== null;
        if (!known) {
          winston.warn(
            "This node has no SQL block index (block_data_ref is absent): the SMD block, transaction and contract pollers stay idle"
          );
        }
        return known;
      })
      .catch((err) => {
        probe = null;
        winston.warn(`Could not tell whether this node keeps the SQL block index, retrying next poll: ${err.message}`);
        return false;
      });
  }
  return probe;
}

module.exports = { hasBlockIndex };
