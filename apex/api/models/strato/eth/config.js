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
    port: '15433',
    dialect: 'postgres',
  },
  test: {
    username: 'postgres',
    password: 'api',
    database: 'eth_' + nodeUUID,
    host: 'postgres',
    port: '5432',
    dialect: 'postgres',
  },
  production: {
    username: '__strato_postgres_user__',
    password: '__strato_postgres_password__',
    database: 'eth_' + nodeUUID,
    host: '__strato_postgres_host__',
    port: '__strato_postgres_port__',
    dialect: 'postgres',
    logging: false,
  },
};

module.exports = {dbConfig};
