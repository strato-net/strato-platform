const Queue = require('promise-queue');
const cors = require('cors');
const bodyParser = require('body-parser');
const express = require('express');
const util = require('./lib/util');
const consumer = require('./consumer.js');
const toSchemaString = util.toSchemaString;
const proxy = require('express-http-proxy');


function startCirrus() {
  return function(scope) {
    return new Promise(function(resolve, reject) {

      let app = express();
      // TODO: remove this temporary solution when bloc and blockapps-rest know the difference between cirrus and postgrest calls
      app.use('/search', proxy(process.env['postgrestRoot'])); // e.g. cirrus:3333/search/abc -> postgrest:3000/abc

      app.use(bodyParser.json({limit: '500mb'}));
      app.use(bodyParser.urlencoded({limit: '500mb', extended: true }));

      // create the pool somewhere globally so its lifetime
      // lasts for as long as your app is running
      var pool = scope.pool;
      var queue = new Queue(1, Infinity); // 1 concurrent job, infinite size queue

      if(!scope.pool) {
        throw new Error(`The postgres pool is not on the scope.
                         Be sure to add the pool to scope when starting
                         the cirrus server.`)
      }

      app.post('/', function (req, res, next) {
        var contractMetaData = req.body;

        // incase the binaries are attached, remove them so we don't store
        delete contractMetaData["bin"];
        delete contractMetaData["bin-runtime"];

        var schema = toSchemaString(contractMetaData);

        global.contractMap[req.body.codeHash] = contractMetaData;
        console.log("global.contractMap: " + JSON.stringify(global.contractMap));
        console.log("Schema: " + schema)

        pool.query(schema)
          .then(_ => {
            console.log("done creating new table for contract")
            console.log('Resetting the offset for kafka');
            consumer.resetOffset(scope);
            res.send(schema)
            next();
          })
          .catch(err => {
            console.log(err);
            throw new Error(err);
          })
      });

      app.get('/', function (req, res, next) {
        res.send('Hello cirrus!');
        // Unnecessary since a response has already been sent
        // pool
        //   .query("select count(*) from information_schema.tables;")
        //   .then(r => console.log(JSON.stringify(r)))
        next()
      });

      app.listen(3333, cors(), function (req, res) {
        console.log('cirrus is listening on port 3333!');
      });

      resolve(scope);
    });
  }
}

module.exports = startCirrus;
