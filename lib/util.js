var Promise = require("bluebird");
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?
var chalk = require('chalk');
var bajs = require('blockapps-js');
var traverse = require('traverse');

const typeMapping = {'Bytes':'text', 'Bool':'boolean', 'String':'text', 'Int':'integer DEFAULT 0', 'Address':'text', 'json':'json DEFAULT \'{}\''}

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
  var types = toSchema(typeMapping)(json.xabi.vars)
  var end = __.map(types, (v, k) => "\x22"+ k + "\x22" + " " + v);
  var tableCreate = "CREATE TABLE IF NOT EXISTS " + "\x22" + json.name + "\x22" + " (" + end.join(', ') + " ); ";
  var indexCreate = "CREATE INDEX IF NOT EXISTS idx ON " + "\x22" + json.name + "\x22" + " (address); ";
  var nameAdd = "INSERT INTO contract VALUES (DEFAULT, '" + json.codeHash + "', '" + json.name + "', '" + JSON.stringify(json) +  "' ) ON CONFLICT DO NOTHING; ";

  return "BEGIN; " + tableCreate + indexCreate + nameAdd + " COMMIT;"
}

// cleanState :: Object -> [{key: value}]
// TODO add filtering on `public` here?
function cleanState(o) {
  return _.flow(
    _.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('function (') === -1) // remove functions
   ,_.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('mapping (')  === -1) // remove mappings
   ,_.mapValues(v => (typeof v !== 'object' || v === 'null') ? v : (v.key === undefined ? v : v.key)) // reduce enums
  )(o)
};

function stateToBody(state, address) {

  var xabi = global.contractMap[state[address].codeHash];
  if((typeof xabi) !== 'undefined'){

    var tmpStr = JSON.stringify(global.contractMap[state[address].codeHash]);

    var parsed = JSON.parse(tmpStr);

    //console.log("Attaching: " + xabi.name);

    xabi.address = address;
    parsed.address = address;


    try {
      //var o = bajs.Solidity.attach(xabi);
      //console.log("Calling attach()");
      var o = bajs.Solidity.attach(parsed);
      //console.log("Done calling attach()")
      var p = Promise.props(o.state).then(function(sVars) {
        var parsed = traverse(sVars).forEach(function (x) {
          if (Buffer.isBuffer(x)) {
            // console.log("The buffer is " + x.toString('hex'))
            this.update(x.toString('hex'));
          }
        });
      return sVars;
      });
      return p;
    } catch (error) {
      console.log(chalk.red("Failed to attach solidity object: " + error));
      //return Promise.props({});
      return Promise.reject("Failed to attach solidity object: " + error);
    }
  } else {
    return Promise.reject("No table found");
    //throw new Error("No table found for contract");
  }
}


module.exports = {
  toSchema: toSchema,
  toSchemaString: toSchemaString,
  cleanState: cleanState,
  stateToBody: stateToBody,
}
