var http = require('http'),
 Pool = require('pg-pool'),
 Queue = require('promise-queue'),
 express = require('express'),
 path = require('path'),
 bodyParser = require('body-parser'),
 logger = require('morgan'),
 debug = require('debug')('myapp:server'),
 cors = require('cors'),
 bodyParser = require('body-parser'),
 express = require('express'),
 util = require('./lib/util'),
 consumer = require('./consumer.js'),
 toSchemaString = util.toSchemaString,
 router = express.Router();

function startCirrus() {
  return function(scope) {
    return new Promise(function(resolve, reject) {
      // scope.app = express();
      // var app = scope.app;
      //app.use(bodyParser.json())
      var app = express();
      app.use(bodyParser.json({limit: '500mb'}));
      app.use(bodyParser.urlencoded({limit: '500mb', extended: true }));


      var _ = require('lodash/fp');
      var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?


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
        var schema = toSchemaString(req.body);
        global.contractMap[req.body.codeHash] = req.body;
        console.log("global.contractMap: " + JSON.stringify(global.contractMap));
        console.log("Schema: " + schema)

        pool.query(schema)
          .then(_ => {
            console.log("done creating new table for contract")
            return consumer.resetOffset()(scope);
          })
          .then(scope => {
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
        pool
          .query("select count(*) from information_schema.tables;")
          .then(r => console.log(JSON.stringify(r)))
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
