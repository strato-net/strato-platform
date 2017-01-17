var Pool = require('pg-pool');
var rp = require("request-promise");
var util = require('./lib/util');
var Promise = require('bluebird');
var toSchemaString = util.toSchemaString;

function initCirrus(scope) {
  scope.contractMap = {};
  scope.pool = {};
  scope.contractMap = {};

  var pgConfig = {
    host: (process.env.POSTGRES || 'postgres'),
    user: 'postgres',
    //password: 'api',
    database: 'cirrus',
    port: 5432
  };
  return getPostgres(pgConfig)(scope)
    .then(createContractABITable())
    .then(fetchABIs())
    .then(generateContractTables())
    .then(getKafkaTopic())
    .catch(err => {
      console.log('Failed to init', err)
    })
}

function getPostgres(pgConfig) {
  return function(scope) {
    return new Promise(function(resolve, reject) {
        scope.pool = new Pool(pgConfig);

        scope.pool.on('error', function(error, client) {
          console.log("Couldn't connect to postgres: " + error);
          process.exit(1);
        })
      resolve(scope);
    })
  }
}

function fetchABIs() {
  return function(scope) {
    console.log('fetching abi data');
    var postgrestHost = (process.env.POSTGREST || 'postgrest:3001');
    var options = {
      method: 'GET',
      url: 'http://' + postgrestHost + '/contract',
      // url: 'http://' + postgrestHost ,
      json: true,
    };

    return rp(options)
      .then(function(response) {
        console.log('Response from Postgrest:', response);

        //set abi data if it already exists in postgres table contract
        if(response.length > 0) {
          response.forEach(x => {
            // scope.contractMap[x.codeHash] = x.abi
            global.contractMap[x.codeHash] = x.abi;
          });
        }
        return scope;
      })
      .catch(function(error) {
        console.log('postgrest failed to obtain ABIs error ', error.message);
        if(error.message.includes('ECONNREFUSED')) {
          console.log("Restarting, awaiting ");
          process.exit(1);
        }
        return scope;
      });
  }
}

function createContractABITable() {
  return function(scope) {
    var contractTable = 'BEGIN; CREATE TABLE IF NOT EXISTS "contract" (id serial, "codeHash" text PRIMARY KEY, "name" text, "abi" text); CREATE INDEX IF NOT EXISTS idx ON "contract" ("codeHash"); COMMIT;'
    return scope.pool.query(contractTable)
      .then(r => {
        console.log("Created contract table")
        return scope;
      })
      .catch((err) => {
        console.log("Couldn't create contract table: " + err);
        return scope;
      });
  }
}

function generateContractTables() {
  return function(scope) {
    var schemas = []
    for(codeHash in global.contractMap) {
      schemas.push(toSchemaString(global.contractMap[codeHash]));
    }
    return Promise
      .each(schemas, function(schema){
        scope.pool.query(schema)
          .then(_ => console.log("done creating new schema for contract"));
      })
      .then(function(){
        return scope;
      })
  };
}

function getKafkaTopic() {
  return function(scope) {
    console.log('made it!');
    var stratoHost    = (process.env.STRATO    || 'strato:3000') ;
    var options = {
      method: 'GET',
      url: 'http://' + stratoHost + '/' + '/eth/v1.2/uuid',
      json: true
    };
    return rp(options)
      .then(function(r) {
        scope.kafkaTopic = 'statediff_' + r.peerId;
        return scope;
      })
      .catch(function(err) {
        console.log('Got an error querying strato for kafka topic: ', err.message);
        throw new Error('Got an error querying strato for kafka topic: ', err.message);
      })
  }
}
module.exports = initCirrus;
