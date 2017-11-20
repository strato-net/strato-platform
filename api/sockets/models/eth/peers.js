const db = require('./connection');

const Peers = db.sequelize.define('p_peer', {
  pubkey: {
    type: db.Sequelize.CHAR
  },
  ip: {
    type: db.Sequelize.CHAR
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
    type: db.Sequelize.CHAR
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
    type: db.Sequelize.CHAR
  },
  last_best_block_hash: {
    // character varying
    type: db.Sequelize.CHAR
  },
  bond_state: {
    // bigint
    type: db.Sequelize.BIGINT
  },
  version: {
    // character varying
    type: db.Sequelize.CHAR
  }
}, { freezeTableName: true, timestamps: false });

module.exports = Peers;

// Peer.findAll().then(users => {
//   console.log("users.count", users.rows);
// })

// Peer.count().then( temp => {
//   console.log("temp", temp);
// })