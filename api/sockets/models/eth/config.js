var request = require('sync-request');

function getNodeUUID() {
  let nodeUUID
  while (true) {
    if (!nodeUUID) {
      const res =  request('GET',`http://${process.env['STRATO_LOCAL_HOST']}/strato-api/eth/v1.2/uuid`)
      var user = JSON.parse(res.getBody('utf8'));
      nodeUUID = user && user.peerId
    }
    else {
      return nodeUUID
    }
  }
}

const development = {
  username: "postgres",
  password: "api",
  database: 'eth_' + getNodeUUID(),
  host: "postgres",
  port: "5432",
  dialect: "postgres"
}

module.exports = {development}