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

var bajs = require('blockapps-js');

var util = require('./lib/util');

var router = express.Router();
var app = express();
app.use(bodyParser.json())

////////////////

var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?

// toSchema :: [(key: value)] -> Object -> Schema
// we might want to filter on `public` here in the future
var toSchema = typeMapping => _.flow(
                                 _.omitBy(o => o.type == 'Mapping')
                                ,_.mapValues(v => v.typedef !== undefined ? 'String' : v.type)
                                ,_.mapValues(v => v == 'Array' ? 'json' : v) // this is perhaps fast if it is array
                                ,_.mapValues(v => typeMapping[v])
                                ,_.merge({address: "text PRIMARY KEY"})
                              )
 
// this should arguably be replaced by `sequelize`
var toSchemaString = function(json){ 

  var typeMapping = {'String':'text', 'Int':'integer DEFAULT 0', 'Address':'text', 'json' : 'json DEFAULT {}'}

  var types = toSchema(typeMapping)(json.xabi.vars)
  var end = __.map(types, (v, k) => "\x22"+ k + "\x22" + " " + v);
  var tableCreate = "CREATE TABLE IF NOT EXISTS " + "\x22" + json.name + "\x22" + " (" + end.join(', ') + " ); ";
  var indexCreate = "CREATE INDEX IF NOT EXISTS idx ON " + "\x22" + json.name + "\x22" + " (address); ";
  var nameAdd = "INSERT INTO contract VALUES (DEFAULT, '" + json.codeHash + "', '" + json.name + "') ON CONFLICT DO NOTHING; ";

  return "BEGIN; " + tableCreate + indexCreate + nameAdd + " COMMIT;"
}

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

var nameSchema = 'BEGIN; CREATE TABLE IF NOT EXISTS "contract" (id serial, "codeHash" text PRIMARY KEY, "name" text); CREATE INDEX IF NOT EXISTS idx ON "contract" ("codeHash"); COMMIT;'

// create the pool somewhere globally so its lifetime
// lasts for as long as your app is running
var pool = new Pool(config)


pool
  .query(nameSchema)
  .then(r => console.log("Created contract table"))
////////////////////


app.post('/', function (req, res, next) {
  var schema = toSchemaString(req.body);
  global.contractMap[req.body.codeHash] = req.body;
  try{
    pool
      .query(schema)
      .then(_ => console.log("done creating new schema for contract"))
  } catch(e){
    console.log("error converting schema: " + e)
  }
  console.log(schema)
  res.send(schema);
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

