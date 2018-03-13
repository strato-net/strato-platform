const db = require('./connection');

const Peer = db.sequelize.define('p_peer', {
  id: {
    type: db.Sequelize.BIGINT,
    primaryKey: true
  },
  pubkey: {
    type: db.Sequelize.STRING
  },
  ip: {
    type: db.Sequelize.STRING
  },
  tcp_port: {
    type: db.Sequelize.BIGINT
  },
  udp_port: {
    type: db.Sequelize.BIGINT
  },
  num_sessions: {
    type: db.Sequelize.BIGINT
  },
  last_msg: {
    type: db.Sequelize.STRING
  },
  last_msg_time: {
    //timestamp with time zone
    type: db.Sequelize.DATE
  },
  enable_time: {
    //timestamp with time zone
    type: db.Sequelize.DATE
  },
  udp_enable_time: {
    //timestamp with time zone
    type: db.Sequelize.DATE
  },
  last_total_difficulty: {
    // character varying
    type: db.Sequelize.STRING
  },
  last_best_block_hash: {
    // character varying
    type: db.Sequelize.STRING(64)
  },
  bond_state: {
    // bigint
    type: db.Sequelize.BIGINT
  },
  active_state: {
    type: db.Sequelize.BIGINT
  },
  version: {
    // character varying
    type: db.Sequelize.STRING
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Peer;
