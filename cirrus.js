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

var nameSchema = 'BEGIN; CREATE TABLE IF NOT EXISTS "contract" ("codeHash" text PRIMARY KEY, "name" text); COMMIT;'

// create the pool somewhere globally so its lifetime
// lasts for as long as your app is running
var pool = new Pool(config)


pool
  .query(nameSchema)
  .then(r => console.log("Created contract table"))
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
    .then(_ => console.log("done creating new schema for contract"))
  next()
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

module.exports = app;

