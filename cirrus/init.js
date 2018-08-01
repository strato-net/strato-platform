var Pool = require('pg-pool'),
 rp = require('request-promise'),
 util = require('./lib/util'),
 Promise = require('bluebird'),
 toSchemaString = util.toSchemaString;

function initCirrus(scope) {
  scope.contractMap = {};
  scope.pool = {};

  var pgConfig = {
    host: (process.env["postgres_host"] || 'localhost'),
    user: (process.env["postgres_user"] || 'postgres'),
    password: (process.env["postgres_password"]),
    database: (process.env["postgres_db"] || 'cirrus'),
    port: parseInt(process.env["postgres_port"] || "5432")
  };
  return getPostgres(pgConfig)(scope)
    .then(cleanDatabase())
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

function cleanDatabase() {
  return function(scope) {
    let tableListQuery;
    let logMessage;
    if (process.env['SINGLE_NODE'] === "true") {
      logMessage = "Running single node - removing all the cirrus tables";
      tableListQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema='public';";
    } else {
      logMessage = "Running multi-node - removing all the cirrus tables except 'contract'";
      tableListQuery = "SELECT table_name FROM information_schema.tables WHERE table_schema='public' and table_name <> 'contract';";
    }
    console.log(logMessage);
    return scope.pool.query(tableListQuery)
      .then(result => {
        const tableList = result.rows.map(row => `"${row['table_name']}"`);
        if (!tableList.length) {
          console.log("Nothing to clean in db");
          return scope;
        }
        console.log('Dropping db tables: ' + tableList.join(', '));
        // Generating query like: 'DROP TABLE "table1", "table2", "table3";'
        const dropTablesQuery = `DROP TABLE ${tableList.join(', ')};`;
        return scope.pool.query(dropTablesQuery)
          .then(_ => {
            console.log("Successfully cleaned the cirrus db from old data");
            return scope;
          })
      })
      .catch((err) => {
        console.error("Couldn't clean the cirrus db: " + err);
        process.exit(1);
      });
  }
}

function fetchABIs() {
  return function(scope) {
    console.log('Fetching abi data');
    var postgrestRoot = (process.env["postgrestRoot"] || "http://localhost/cirrus/search")

    var options = {
      method: 'GET',
      url: postgrestRoot + '/contract',
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
        console.log(`Failed to obtain ABIs from postgrest (request options: ${JSON.stringify(options)})`, error.message);
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
        console.log("Created contract table (if did not exist)");
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
    let schemas = [];
    console.log('creating tables for hashes ', Object.keys(global.contractMap).join(', '));
    for(codeHash in global.contractMap) {
      schemas.push(toSchemaString(global.contractMap[codeHash]));
    }
    return Promise
      .each(schemas, function(schema){
        scope.pool.query(schema).catch(
          err => {
            console.error('could not create table by schema: ', schema, err);
          }
        );
      })
      .then(function(){
        console.log('done generating the tables for contract ABIs');
        return scope;
      })
  };
}

function getKafkaTopic() {
  return function(scope) {
    const stratoRoot = (process.env["stratoRoot"] || 'http://localhost/strato-api/eth/v1.2');
    const options = {
      method: 'GET',
      url: stratoRoot + '/uuid',
      json: true
    };
    if(process.env["stateDiffTopic"]){
      var sd = process.env["stateDiffTopic"];
      scope.kafkaTopic = sd;
      return Promise.resolve(scope);
    } else {
      return rp(options)
        .then(function(r) {
            scope.kafkaTopic = 'statediff';
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
