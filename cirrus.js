const Queue = require('promise-queue');
const cors = require('cors');
const bodyParser = require('body-parser');
const express = require('express');
const util = require('./lib/util');
const consumer = require('./consumer.js');
const toSchemaString = util.toSchemaString;
const proxy = require('express-http-proxy');
const logger  = require('morgan');


function startCirrus() {
  return function(scope) {
    return new Promise(function(resolve, reject) {

      let app = express();
      app.use(logger('dev'));
      // TODO: remove this temporary solution when bloc and blockapps-rest know the difference between cirrus and postgrest calls, also see `/contract` in app.post below
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

      app.post(['/', '/contract'], function (req, res, next) {
	const cb = (schema) => { res.send(schema); next() };

        return consumer.addContract(req.body, cb)(scope);
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
