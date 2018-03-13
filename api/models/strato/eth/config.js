const request = require('sync-request');

// TODO: Clean the UUID retrieval. Should happen at apex initialization.

const res =  request('GET',`${process.env['stratoRoot']}/uuid`);
const user = JSON.parse(res.getBody('utf8'));
const nodeUUID = user && user.peerId;

const dbConfig = {
  development: {
    username: 'postgres',
    password: 'api',
    database: 'eth_' + nodeUUID,
    host: 'localhost',
    port: '5432',
    dialect: 'postgres',
  },
  production: {
    username: 'postgres',
    password: 'api',
    database: 'eth_' + nodeUUID,
    host: 'postgres',
    port: '5432',
    dialect: 'postgres',
    logging: false,
  },
};

module.exports = {dbConfig};
