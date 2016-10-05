var Promise = require("bluebird");

var rp = require("request-promise");
var yaml = require('yaml-parser');
var child_process = require("child_process");

var chalk = require('chalk');

// Load the fp build.
var _ = require('lodash/fp');
var __ = require('lodash'); // not pretty but how else to use __.map((k,v) => {...}) ?

var kafka = require('kafka-node');
var client = new kafka.Client();

var dockerDir = "docker"; // Configurable
var topics = yaml.safeLoad(
  child_process.execSync(
    "docker exec " + dockerDir + "_strato_1 cat .ethereumH/topics.yaml"
  )
);
var topic = topics.statediff;

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
    console.log(m.value);

    var state = JSON.parse(m.value);

    var createdAccounts = Object.keys(state.createdAccounts);
    var updatedAccounts = Object.keys(state.updatedAccounts);
    var deletedAccounts = Object.keys(state.deletedAccounts);

    if(createdAccounts) console.log(chalk.green("Created accounts: " + createdAccounts));
    if(updatedAccounts) console.log(chalk.blue("Updated accounts: " + updatedAccounts));
    if(deletedAccounts) console.log(chalk.red("Deleted accounts: " + deletedAccounts));

    //var key = m.value["updatedAccounts"];
    //var key = Object.keys(m.value.updatedAccounts)[0]
    //console.log("Address: " + key)
    // rest post here

    var toUpload = _.flatten(

      [
          createdAccounts.map(a => {

        }),

        updatedAccounts.map(a => {

          //console.log("Updating account " + a)
          var tKeys = Object.keys(state.updatedAccounts[a].storage)
          //console.log("Storage to change: " + JSON.stringify(state.updatedAccounts[a].storage))

          var val = state.updatedAccounts[a].storage[tKeys[0]];
          if(val)
            val = parseInt(val['newValue'], 16);
          else
            val = 0;

          var host = process.env.HOST || 'localhost'
          var options = { method: 'PATCH',
            url: 'http://' + host + ':3000/' + 'SimpleStorage?address=eq.' + a,
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
      console.log("Done updating accounts");
    });
});

consumer.call('on', 'error', function (err) {
  console.log("Caught error: " + err)
})


