const request = require('sync-request'); //fixme - the npm page suggests not to use this in a a production environtment

// TODO: Clean the UUID retrieval. Should happen at apex initialization.

console.log('ahoy',`${process.env['stratoRoot']}/uuid`)
const res =  request('GET',`${process.env['stratoRoot']}/uuid`);
console.log(res)
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
