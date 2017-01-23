var Promise = require("bluebird");
var retry = require('bluebird-retry');
var rp = require("request-promise");
var yaml = require('yaml-parser');
var child_process = require("child_process");
var bajs = require('blockapps-js');
var util = require('./lib/util');
var cleanState = util.cleanState;
var stateToBody = util.stateToBody;
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
var specificClient = new kafka.Client(zookeeperHost);

bajs.setProfile('strato-dev', 'http://' + stratoHost)
console.log("Connections are:\n\tstrato: " + stratoHost + "\n\tpostgrest: " + postgrestHost + "\n\tzookeeper: " + zookeeperHost);

function initKafkaConsumers() {
  return function(scope) {
    return new Promise(function(resolve) {
      var clientAllContracts = new kafka.Client(zookeeperHost);
      var clientSpecificContract = new kafka.Client(zookeeperHost);
      var options = {
        // fromOffset: true,
        fetchMaxBytes: 1024*1024*15,
      };
      scope.consumerAllContracts = new kafka.Consumer(clientAllContracts, [], options);
      scope.consumerSpecificContract = new kafka.Consumer(clientSpecificContract, [], options);
      resolve(scope);
    });
  };
}

function startConsumer(topic, consumer, contractMap, startOffset, endOffset) {
  // return function(scope) {



    // if()
    // var topic = scope.kafkaTopic;
    // var offsets = Promise.promisifyAll(new kafka.Offset(client));
    // var offset = offsets.fetchLatestOffsetsAsync([topic]).get(topic).get(0);

    var payloads =  [
      {
        topic: topic,
        offset: startOffset,
        partition: 0,
      }
    ];
    consumer.addTopics(payloads, function (err, added) {
      if(err) {
        console.log('Error adding kafka topic', err);
      }
    }, true);

    consumer.on('message', function (m) {

         console.log(chalk.yellow("Incoming state update..."));
         var state = JSON.parse(m.value);
         var emptyStringHash = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

         // for now, remove accounts that have no code
         state.createdAccounts = _.omitBy(v => v.codeHash == emptyStringHash)(state.createdAccounts)
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
    	              // console.log("Body is: " + JSON.stringify(x));
                   var options = { method: 'POST',
                     url: 'http://' + postgrestHost + '/' + global.contractMap[state.createdAccounts[a].codeHash].name,
                     headers:
                      { 'cache-control': 'no-cache',
                        'content-type': 'application/json' },
                     body: x,
                     json: true };
                     //console.log("create options: " + JSON.stringify(options));
                     return rp(options).promise();
                   })
                 .catch(err => console.log("Warn: " + err))
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
                     //console.log("update options: " + JSON.stringify(options));
                     return rp(options).promise();
                 })
               .catch(err => console.log("Warn: " + err))
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

    consumer.on('error', function (err) {
     console.log("Caught error: " + err)
    })
  // }
}


// function newContractConsumer() {
//
// }



module.exports = {
  initKafkaConsumers: initKafkaConsumers,
  startConsumer: startConsumer,
};
