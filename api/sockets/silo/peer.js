const Peer = sequelize.define('p_peer', {
  pubkey: {
    type: Sequelize.CHAR
  },
  ip: {
    type: Sequelize.CHAR
  },
  tcp_port: {
    type: Sequelize.BIGINT
  },
  udp_port: {
    type: Sequelize.BIGINT
  },
  num_sessions: {
    type: Sequelize.BIGINT
  },
  last_msg: {
    type: Sequelize.CHAR
  }
});