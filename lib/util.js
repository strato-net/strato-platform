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

  var typeMapping = {'String':'text DEFAULT "\x22""\x22"', 'Int':'integer DEFAULT 0', 'Address':'text', 'json' : 'json DEFAULT {}'}

  var types = toSchema(typeMapping)(json.xabi.vars)
  var end = __.map(types, (v, k) => "\x22"+ k + "\x22" + " " + v);
  var tableCreate = "CREATE TABLE IF NOT EXISTS " + "\x22" + json.name + "\x22" + " (" + end.join(', ') + " );";
  var indexCreate = "CREATE INDEX IF NOT EXISTS idx ON " + "\x22" + json.name + "\x22" + "(address);";
  var nameAdd = "INSERT INTO contracts VALUES (" + json.codeHash + ", " + json.name + ");";

  return "BEGIN; " + tableCreate + indexCreate + nameAdd + "COMMIT;"
}

// cleanState :: Object -> [{key: value}]
var cleanState = s => _.map(o => 
                    _.flow(
                      _.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('function (') === -1)
                     ,_.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('mapping (')  === -1)
                     ,_.mapValues(v => (typeof v !== 'object' || v === 'null') ? v : (v.key === undefined ? v : v.key))
                     //,_.merge({address: o.address}) // PRIMARY KEY
                    )(s)
                )

module.exports = {toSchema:toSchema, toSchemaString:toSchemaString, cleanState:cleanState}