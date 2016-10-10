var Promise = require("bluebird");

var rp = require("request-promise");
var yaml = require('yaml-parser');
var child_process = require("child_process");

var chalk = require('chalk');

// Load the fp build.
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?

var kafka = require('kafka-node');

// var dockerDir = "docker"; // Configurable
// var topics = yaml.safeLoad(
//   child_process.execSync(.peerId
//     "docker exec " + dockerDir + "_strato_1 cat .ethereumH/topics.yaml"
//   )
// );
// var topic = topics.statediff;

var stratoHost = (process.env.STRATO || 'strato') + ':80';
var postgrestHost = (process.env.POSTGREST || 'postgrest' ) + ':3001';
var zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper') + ':2181';

var topic;

var options = { method: 'GET',
            url: 'http://' + stratoHost + '/' + '/eth/v1.2/uuid',
            json: true };

rp(options).promise().then(r => {topic = r.peerId; 
  console.log("Topic: " + topic)
});


  var topic = "ebb67b41ddb398f9bf2054a5ba863cfbdf8d934c";

  var kafkaTopic = 'statediff_' + topic;
  console.log("Topic is: " + kafkaTopic)

  var client = new kafka.Client(zookeeperHost);

  var offsets = Promise.promisifyAll(new kafka.Offset(client));
  var offset = offsets.fetchLatestOffsetsAsync([kafkaTopic]).get(kafkaTopic).get(0);

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

      //console.log(m.value);

      var state = JSON.parse(m.value);

      // for now, only update accounts with changed storage
      state.updatedAccounts = _.omitBy(v => Object.keys(v.storage).length == 0)(state.updatedAccounts)
      //console.log("Cleaned state: " + JSON.stringify(state.updatedAccounts));

      var createdAccounts = Object.keys(state.createdAccounts);
      var updatedAccounts = Object.keys(state.updatedAccounts);
      var deletedAccounts = Object.keys(state.deletedAccounts);

      console.log(chalk.green("|\tCreated accounts: " + createdAccounts));
      console.log(chalk.blue("|\tUpdated accounts: " + updatedAccounts));
      console.log(chalk.red("|\tDeleted accounts: " + deletedAccounts));

      var toUpload = _.flatten(

        [
          createdAccounts.map(a => {

            var tKeys = Object.keys(state.createdAccounts[a]);

            var val = state.createdAccounts[a].storage[tKeys[0]];
            if(val)
              val = parseInt(val['newValue'], 16);
            else
              val = 0;

            var options = { method: 'POST',
              url: 'http://' + postgrestHost + '/SimpleStorage',
              headers: 
               { 'cache-control': 'no-cache',
                 'content-type': 'application/json' },
              body: {storedData: val, address: a}, // replace this with actual storage
              json: true };

              return rp(options).promise();
          }),

          updatedAccounts.map(a => {
            var tKeys = Object.keys(state.updatedAccounts[a].storage)

            var val = state.updatedAccounts[a].storage[tKeys[0]];
            if(val)
              val = parseInt(val['newValue'], 16);
            else
              val = 0;

            var options = { method: 'PATCH',
              url: 'http://' + postgrestHost + '/SimpleStorage?address=eq.' + a,
              headers: 
               { 'cache-control': 'no-cache',
                 'content-type': 'application/json' },
              body: {storedData: val}, // replace this with actual storage
              json: true };

              return rp(options).promise();
          }),

          deletedAccounts.map(a => {

          })
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



