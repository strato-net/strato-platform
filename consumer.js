var Promise = require("bluebird");

var rp = require("request-promise");
var yaml = require('yaml-parser');
var child_process = require("child_process");
var bajs = require('blockapps-js');
bajs.setProfile('strato-dev', 'http://strato')

var util = require('./lib/util');

var traverse = require('traverse');

var chalk = require('chalk');

// Load the fp build.
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?

var kafka = require('kafka-node');

var stratoHost    = (process.env.STRATO    || 'strato:3000') ;
var postgrestHost = (process.env.POSTGREST || 'postgrest:3001');
var zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper:2181');

var client = new kafka.Client(zookeeperHost);

var options = { method: 'GET',
            url: 'http://' + stratoHost + '/' + '/eth/v1.2/uuid',
            json: true };


// cleanState :: Object -> [{key: value}]
// TODO add filtering on `public` here?
var cleanState = function(o) {
                    return _.flow(
                      _.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('function (') === -1) // remove functions
                     ,_.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('mapping (')  === -1) // remove mappings
                     ,_.mapValues(v => (typeof v !== 'object' || v === 'null') ? v : (v.key === undefined ? v : v.key)) // reduce enums
                    )(o)
                  };


var stateToBody = function(state, address) {
  var xabi = global.contractMap[state[address].codeHash];
  var tmpStr = JSON.stringify(global.contractMap[state[address].codeHash]);
  var parsed = JSON.parse(tmpStr);
 
  console.log("Attaching: " + xabi.name);
 
  xabi.address = address;
  parsed.address = address;

  //console.log(JSON.stringify(xabi));

  try {
    //var o = bajs.Solidity.attach(xabi);
    var o = bajs.Solidity.attach(parsed);
    var p = Promise.props(o.state).then(function(sVars) {
      var parsed = traverse(sVars).forEach(function (x) {
        if (Buffer.isBuffer(x)) {
          this.update(x.toString());
        }
      });
     return sVars;
    });
    return p;
  } catch (error) {
    console.log(chalk.red("Failed to attach solidity object: " + error));
    return Promise.props({});
  }
}

global.contractMap = {}
 
rp(options).promise().then(r => {

  console.log("Connecting to blockchain: " + r.peerId);

  var topic = 'statediff_' + r.peerId; 

  var offsets = Promise.promisifyAll(new kafka.Offset(client));
  var offset = offsets.fetchLatestOffsetsAsync([topic]).get(topic).get(0);

  var consumer = offset.then(function(offset) {
    return new kafka.Consumer(
      client,
      [{
        topic: topic, 
        offset: offset,
        partition: 0
      }],
      {fromOffset: true}
    );
  });

  consumer.call('on', 'message', function (m) {

        console.log(chalk.yellow("Incoming state update..."));

        var state = JSON.parse(m.value);

        // for now, remove accounts that have no code
        state.createdAccounts = _.omitBy(v => v.codeHash == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")(state.createdAccounts)
        // for now, only update accounts with changed storage
        state.updatedAccounts = _.omitBy(v => Object.keys(v.storage).length == 0)(state.updatedAccounts)

        var createdAccounts = Object.keys(state.createdAccounts);
        var updatedAccounts = Object.keys(state.updatedAccounts);
        var deletedAccounts = Object.keys(state.deletedAccounts);

        console.log(chalk.green("|\tCreated accounts: " + createdAccounts));
        console.log(chalk.blue("|\tUpdated accounts: " + updatedAccounts));
        console.log(chalk.red("|\tDeleted accounts: " + deletedAccounts));

        var toUpload = _.flatten(

          [
            createdAccounts.map(a => {

              stateToBody(state.createdAccounts, a)
                .then(JSON.stringify)
                .then(JSON.parse)
                .then(cleanState)
                .then(x => {
                  x.address = a;
		  console.log(x);
                  var options = { method: 'POST',
                    url: 'http://' + postgrestHost + '/' + global.contractMap[state.createdAccounts[a].codeHash].name,
                    headers: 
                     { 'cache-control': 'no-cache',
                       'content-type': 'application/json' },
                    body: x,
                    json: true };

                    return rp(options).promise();
                  });
            }),

            updatedAccounts.map(a => {

              // this was useful when not using blockapps-js
              // var tKeys = Object.keys(state.updatedAccounts[a].storage)
              // var val = state.updatedAccounts[a].storage[tKeys[0]];
              // if(val)
              //   val = parseInt(val['newValue'], 16);
              // else
              //   val = 0; 

              stateToBody(state.updatedAccounts, a)
                .then(JSON.stringify)
                .then(JSON.parse)
                .then(cleanState)
                .then(x => {
                  x.address = a;
                  var options = { method: 'PATCH',
                    url: 'http://' + postgrestHost + '/' + global.contractMap[state.updatedAccounts[a].codeHash].name+ '?address=eq.' + a,
                    headers: 
                     { 'cache-control': 'no-cache',
                       'content-type': 'application/json' },
                    body: x,
                    json: true };

                    return rp(options).promise();
                });
            }),

            deletedAccounts.map(a => {})
          ]
        )

        Promise.all(toUpload)
        .catch(function (error){
          console.log("Caught an error: " + error);
        })
        .then(function (error, response, body) {
          // if (error){
          //   throw new Error(error);
          // } 
          console.log(chalk.yellow("... done updating accounts"));
        });
    });

  consumer.call('on', 'error', function (err) {
    console.log("Caught error: " + err)
  })
})
