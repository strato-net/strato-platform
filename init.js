var Pool = require('pg-pool'),
 rp = require('request-promise'),
 util = require('./lib/util'),
 Promise = require('bluebird'),
 consumer = require('./consumer')
 toSchemaString = util.toSchemaString;

function initCirrus(scope) {
  scope.contractMap = {};
  scope.pool = {};

  var pgConfig = {
    host: (process.env["postgres_host"] || 'postgres'),
    user: (process.env["postgres_user"] || 'postgres'),
    password: (process.env["postgres_password"]),
    database: (process.env["postgres_db"] || 'cirrus'),
    port: parseInt(process.env["postgres_port"] || "5432")
  };
  return getPostgres(pgConfig)(scope)
    .then(createContractABITable())
    .then(fetchABIs())
    .then(generateContractTables())
    .then(getKafkaTopic())
    .catch(err => {
      console.log('Failed to init', err)
      throw new Error('Failed to init cirrus: ' + err)
    })
}

function getPostgres(pgConfig) {
  return function(scope) {
    return new Promise(function(resolve, reject) {
        scope.pool = new Pool(pgConfig);

        // exit the process for docker to restart, make sure environment variables always sent
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
    var postgresturl = (process.env["postgresturl"] || "http://postgrest:3001")

    var options = {
      method: 'GET',
      url: postgresturl + '/contract',
      json: true,
    };

    return rp(options)
      .then(function(response) {
        console.log('Response from Postgrest:', response);

        //set abi data if it already exists in postgres table contract
        if(response.length > 0) {
          response.forEach(x => {
            // scope.contractMap[x.codeHash] = x.abi
            global.contractMap[x.codeHash] = JSON.parse(x.abi);
          });
        }
        return scope;
      })
      .catch(function(error) {
        console.log('postgrest failed to obtain ABIs error ', error.message);
        console.log("Restarting, awaiting ");
        process.exit(1);
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
      console.log('rebuilding DB', codeHash);
      schemas.push(toSchemaString(global.contractMap[codeHash]));
    }
    return Promise
      .each(schemas, function(schema){
        scope.pool.query(schema)
          .then(_ => console.log("done creating table for contract"));
      })
      .then(function(){
        return scope;
      })
  };
}

function getKafkaTopic() {
  return function(scope) {
    var stratoRoot = (process.env["stratourl"] || 'http://strato:3000');
    var options = {
      method: 'GET',
      url: stratoRoot + '/eth/v1.2/uuid',
      json: true
    };
    if(process.env["stateDiffTopic"]){
      var sd = process.env["stateDiffTopic"];
      scope.kafkaTopic = sd;
      return Promise.resolve(scope);
    } else {
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
}
module.exports = initCirrus;
