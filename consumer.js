var Promise = require('bluebird'),
 kafka = require('kafka-node'),
 retry = require('bluebird-retry'),
 rp = require('request-promise'),
 yaml = require('yaml-parser'),
 child_process = require("child_process"),
 bajs = require('blockapps-js'),
 util = require('./lib/util'),
 traverse = require('traverse'),
 chalk = require('chalk'),
 _ = require('lodash/fp'),
 __ = require('lodash'),
 Consumer = kafka.Consumer;

const stratoHost    = (process.env.STRATO    || 'strato:3000') ;
const postgrestHost = (process.env.POSTGREST || 'postgrest:3001');
const zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper:2181');



function start() {
  return function(scope) {
    return new Promise((resolve, reject) => {
      console.log("Connections are:\n\tstrato: " + stratoHost + "\n\tpostgrest: " + postgrestHost + "\n\tzookeeper: " + zookeeperHost);
      bajs.setProfile('strato-dev', 'http://' + stratoHost)

      var client = new kafka.Client(zookeeperHost);
      const payloads = [{
        topic: scope.kafkaTopic,
        offset: 0 ,
        partition: 0,
      }];
      const options = {
        fromOffset: true,
        fetchMaxBytes: 1024*1024*15,
      };
      scope.consumer = Promise.promisifyAll(new Consumer(client, payloads, options));

      scope.consumer.on('message', consumeMessage);
      scope.consumer.on('error', function (err) {
        console.log("Caught error: " + err)
      })

      resolve(scope);
    })
  }
}

function resetOffset() {
  return function(scope) {
    const topicsToRemove = [scope.kafkaTopic];
    const topics = [{
      topic:scope.kafkaTopic,
      offset:0
    }];
    return scope.consumer.removeTopicsAsync(topicsToRemove)
      .then( _ => {
        return scope.consumer.addTopics(topics, function (err, removed) {}, true);
      })
      .then( _ => {
        return scope;
      })
      .catch(err => {
        throw new Error(err);
      })

  }
}

function consumeMessage(m) {
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
             // console.log("Body is: " + JSON.stringify(x));
            var options = { method: 'POST',
              url: 'http://' + postgrestHost + '/' + global.contractMap[state.createdAccounts[a].codeHash].name,
              headers:
               { 'cache-control': 'no-cache',
                 'content-type': 'application/json' },
              body: x,
              json: true };
              //console.log("create options: " + JSON.stringify(options));
              return rp(options).promise()
                .catch(err => {
                  console.log('Failed updating contract: ', x);
                  throw new Error(err);
                });
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
              // console.log("update options: " + JSON.stringify(options));
              return rp(options).promise()
                .catch(err => {
                  console.log('Failed updating contract: ', x);
                  throw new Error(err);
                });
          })
        .catch(err => {
          console.log('Warn: ' + err,
                      'Failed on offset: ' + m.offset);
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
    console.log(chalk.yellow("... done updating accounts"));
  });
}

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

// cleanState :: Object -> [{key: value}]
// TODO add filtering on `public` here?
function cleanState(o) {
  return _.flow(
    _.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('function (') === -1) // remove functions
   ,_.pickBy(v => (typeof v !== `string`) ? true : v.indexOf('mapping (')  === -1) // remove mappings
   ,_.mapValues(v => (typeof v !== 'object' || v === 'null') ? v : (v.key === undefined ? v : v.key)) // reduce enums
  )(o)
};

module.exports = {
  start:start,
  resetOffset:resetOffset,
};
