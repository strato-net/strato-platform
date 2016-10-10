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


// by default the pool will use the same environment variables
// as psql, pg_dump, pg_restore etc:
// https://www.postgresql.org/docs/9.5/static/libpq-envars.html

// you can optionally supply other values
var config = {
  host: (process.env.POSTGRES || 'postgres'),
  user: 'postgres',
  //password: 'bar',
  database: 'cirrus',
  port: 5432
};

// create the pool somewhere globally so its lifetime
// lasts for as long as your app is running
var pool = new Pool(config)

////////////////////

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
      console.log("Hello cirrus")
    })
  next()
});

app.get('/', function (req, res, next) {
  res.send('Hello World!');
  pool
    .query("SELECT * from postgres;")
    .then(function() {
      console.log("Hello cirrus")
    })
  next()
});

app.listen(3333, cors(), function (req, res) {
  console.log('Example app listening on port 3333!');
});

module.exports = app;

