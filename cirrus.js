var http = require('http');
var Pool = require('pg-pool')

var express = require('express');
var path = require('path');
var bodyParser = require('body-parser');

var logger = require('morgan');

var debug = require('debug')('myapp:server');
var cors = require('cors');

var bodyParser = require('body-parser')

var express = require('express');

var util = require('./lib/util')

var router = express.Router();
var app = express();
app.use(bodyParser.json())

////////////////

app.post('/', function (req, res, next) {
  var schema;
  try {
    schema = util.toSchemaString(req.body);
  } catch(e){
    console.log("error converting schema: " + e)
  }
  console.log(schema)
  res.send(schema);
  pool
    .query(schema)
    .then(function() {
      console.log("Hello")
    })
  next()
});

app.get('/', function (req, res, next) {
  res.send('Hello World!');
  console.log(req.body) // populated!
  next()
});

app.listen(3333, cors(), function (req, res) {
  console.log('Example app listening on port 3333!');
});
// by default the pool will use the same environment variables
// as psql, pg_dump, pg_restore etc:
// https://www.postgresql.org/docs/9.5/static/libpq-envars.html

// you can optionally supply other values
var config = {
  host: 'postgres',
  user: 'postgres',
  //password: 'bar',
  database: 'cirrus',
  port: 5432
};

// create the pool somewhere globally so its lifetime
// lasts for as long as your app is running
var pool = new Pool(config)

// var server = http.createServer(function(req, res) {

//   var onError = function(err) {
//     console.log(err.message, err.stack)
//     res.writeHead(500, {'content-type': 'text/plain'});
//     res.end('An error occurred');
//   };

//   pool.query('INSERT INTO "Sample" (address) VALUES ($1)', ["deadbeef"], function(err) {
//     if (err) return onError(err);

//     // get the total number of visits today (including the current visit)
//     pool.query('SELECT COUNT(*) AS count FROM "Sample"', function(err, result) {
//       // handle an error from the query
//       if(err) return onError(err);
//       res.writeHead(200, {'content-type': 'text/plain'});
//       res.end('There are ' + result.rows[0].count + ' Sample contracts');
//     });
//   });
// });

module.exports = app;

