var Promise = require('bluebird'),
 kafka = require('kafka-node'),
 rp = require('request-promise'),
 yaml = require('yaml-parser'),
 child_process = require("child_process"),
 bajs = require('blockapps-js'),
 util = require('./lib/util'),
 traverse = require('traverse'),
 chalk = require('chalk'),
 _ = require('lodash/fp'),
 __ = require('lodash'),
 delayPromise = util.delayPromise,
 Consumer = kafka.Consumer;

const stratoHost    = (process.env.STRATO    || 'strato:3000') ;
const postgrestHost = (process.env.POSTGREST || 'postgrest:3001');
const zookeeperHost = (process.env.ZOOKEEPER || 'zookeeper:2181');



function start()
  {
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
        fetchMaxBytes: 1024*1024*150,
      };
      scope.consumer = Promise.promisifyAll(new Consumer(client, payloads, options));
      scope.offset = 0;
      scope.isCirrusInserting = false;

      const useNewConsume = true;
      if(useNewConsume) {
        scope.consumer.on('message', consume(scope));
        scope.consumer.on('error', function (err) {
          console.log("Caught error: " + err)
        })
        resolve(scope);
        return;
      }
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
  console.log(chalk.yellow("Incoming state update at offset: " + m.offset));
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
            var options = { method: 'POST',
              url: 'http://' + postgrestHost + '/' + global.contractMap[state.createdAccounts[a].codeHash].name,
              headers:
               { 'cache-control': 'no-cache',
                 'content-type': 'application/json' },
              body: x,
              json: true };
              return rp(options).promise()
                .catch(err => {
                  console.log('Failed updating contract: ', x);
                  throw new Error(err);
                });
            })
          .catch(err => console.log("Warn: " + err))
      }),
      updatedAccounts.map(a => {
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

function consume(scope) {
  return (m) => {
    var localScope = {};

    //ignore message if cirrus is inserting
    if(scope.isCirrusInserting) {
      return;
    }

    console.log(chalk.yellow("Incoming state update at offset: " + m.offset));
    const topics = [scope.kafkaTopic]
    const accounts = getAccountsForStateDiffss(m);

    // if accounts are empty can continue to next message
    if(accountsAreEmpty(accounts)) {
      return scope;
    }

    scope.consumer.removeTopics(topics, _ => {});
    scope.isCirrusInserting = true;
    scope.offset = m.offset;
    console.log('acount update found at offset: ' + m.offset);

    return getAllStates(accounts)(localScope)
      .then(insertCirrusUpdates())
      .then(localScope => {
        scope.isCirrusInserting = false;
        const addedTopics = [{topic:scope.kafkaTopic, offset:(scope.offset+1)}]
        scope.consumer.addTopics(addedTopics, _ => {}, true);
        console.log('resuming kafka fetch loop, offset is  ' + scope.offset);
        return localScope;
      })
      .catch(err => {
        console.log('Error found while consumer on offset: ' + m.offset, 'error is: ', err);
      })
  }

  // --Support functions consume functions-- //
  function getAccountsForStateDiffss(m) {
    var state = JSON.parse(m.value);

    // remove accounts that have no code
    state.createdAccounts = _.omitBy(v => v.codeHash == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")(state.createdAccounts)
    // only update accounts with changed storage
    state.updatedAccounts = _.omitBy(v => Object.keys(v.storage).length == 0)(state.updatedAccounts)

    const accounts = {
      createdAccounts: state.createdAccounts,
      updatedAccounts: state.updatedAccounts,
      deletedAccounts: state.deletedAccounts,
    };
    return accounts;
  }

  function accountsAreEmpty(accounts) {
    if(__.isEmpty(accounts.createdAccounts)
    && __.isEmpty(accounts.updatedAccounts)
    && __.isEmpty(accounts.deletedAccounts)) {
      return true;
    }
    return false;
  }

  function getAllStates(accounts) {
    return scope => {
      console.log('created Accounts: ');
      return getStates(accounts.createdAccounts)
        .then(states => {
          scope.createdStates = states;
          console.log('updated Accounts: ');
          return getStates(accounts.updatedAccounts);
        })
        .then(states => {
          scope.updatedStates = states;
          console.log('deleted Accounts: ');
          return getStates(accounts.deletedAccounts);
        })
        .then(states => {
          scope.deletedStates = states;
          return scope;
        })
        .catch(err => {
          throw new Error(err);
        })
    }
  }

  function getStates(accounts) {
    const accountAddrs = Object.keys(accounts);
    console.log('addresses: ', accountAddrs);
    var accountPromises = accountAddrs.map(addr => {
      return stateToBody(accounts, addr)
        .then(JSON.stringify)
        .then(JSON.parse)
        .then(cleanState)
        .then(x => {
          x.address = addr;
          x.codeHash = accounts[addr].codeHash;
          console.log('state to be inserted', x);
          return x;
        })
        .catch(err => {
          if(err.includes('No table found')) {
            return;
          }
          throw new Error(err);
        });
    });
    return Promise.all(accountPromises)
      .then(states => {
        var cleanStates = states.filter(state => { return state != undefined });
        return cleanStates;
      })
      .catch(err => {
        throw new Error(err);
      })

  }

  function insertCirrusUpdates() {
    return scope => {
      var httpMethod = 'POST';
      var rpOptionCreated =  buildHttpOptions(scope.createdStates, httpMethod);
      httpMethod = 'PATCH';
      var rpOptionUpdated =  buildHttpOptions(scope.updatedStates, httpMethod);
      httpMethod = 'DELETE';
      var rpOptionDeleted =  buildHttpOptions(scope.deletedStates, httpMethod);
      var options = rpOptionCreated.concat(rpOptionUpdated, rpOptionDeleted);
      return postToPostGrest(options)(scope);
    }
  }

  function buildHttpOptions(states, httpMethod) {
    var options;
    if(!states) {
      return [];
    }
    if(httpMethod === 'POST') {
      options = states.map(state => {
        const codeHash = state.codeHash;
        const url = 'http://' + postgrestHost + '/'
                    + global.contractMap[codeHash].name;
        delete state.codeHash;
        return buildOption(state,httpMethod, url);
      });
    } else if (httpMethod === 'PATCH') {
      options = states.map(state => {
        const codeHash = state.codeHash;
        const url = 'http://' + postgrestHost + '/'
                    + global.contractMap[codeHash].name
                    + '?address=eq.' + state.address;
        delete state.codeHash;
        return buildOption(state, httpMethod, url);
      });
    } else if (httpMethod === 'DELETE') {
      options = states.map(state => {
        const codeHash = state.codeHash;
        const url = 'http://' + postgrestHost + '/'
                    + global.contractMap[codeHash].name
                    + '?address=eq.' + state.address;
        delete state.codeHash;
        return buildOption(state, httpMethod, url);
      });
    }
    return options;
  }

  function buildOption(state,httpMethod, url) {
    return {
      method: httpMethod,
      url: url,
      headers: {
       'cache-control': 'no-cache',
       'content-type': 'application/json'
      },
      body: state,
      json: true
    };
  }

  function postToPostGrest(options) {
    return scope => {
      return Promise.each(options, (option) => {
        return rpRetry(option, 200, 5)
          .then(res => {
            console.log('Successfully inserted ', option.body.address);
            return scope;
          })
          .catch(err => {
            console.log('Failed to ' + option.method , option.body, err)
            return scope;
          });
      });
    }
  }

}

function rpRetry(options, timeout, totalAttempts) {
  var retryDesc = {
    options:options,
    attempt: 1,
    totalAttempts: totalAttempts,
    timeout: timeout,
  };
  return retry(retryDesc);
}

function retry(retryDesc) {
  var errDesc = retryDesc;
  return rp(retryDesc.options)
    .catch(retryErrorHandler(retry, errDesc))
}

function retryErrorHandler(fn, errDesc) {
  return (err => {
    // ignore duplicate key violation
    if(err.statusCode === 409) {
      return
    }

    //ran out of totalAttempts and throw and error
    if(errDesc.attempt >= errDesc.totalAttempts) {
      console.log(err.message);
      throw new Error("Attempted " + errDesc.totalAttempts + " times");
      return;
    }

    //re-attempt to
    return delayPromise(errDesc.timeout)
      .then( _ => {
        const nextAttempt = errDesc.attempt + 1;
        console.log('Re-attempting to post to postrgest with attempt ' + nextAttempt);

        var fnDesc = errDesc;
        fnDesc.attempt = nextAttempt;
        return fn(fnDesc);
      });
  })
}

function stateToBody(state, address) {

  var xabi = global.contractMap[state[address].codeHash];
  if((typeof xabi) !== 'undefined'){

    var tmpStr = JSON.stringify(global.contractMap[state[address].codeHash]);

    var parsed = JSON.parse(tmpStr);


    xabi.address = address;
    parsed.address = address;


    try {
      var o = bajs.Solidity.attach(parsed);
      var p = Promise.props(o.state).then(function(sVars) {
        var parsed = traverse(sVars).forEach(function (x) {
          if (Buffer.isBuffer(x)) {
            this.update(x.toString('hex'));
          }
        });
      return sVars;
      });
      return p;
    } catch (error) {
      console.log(chalk.red("Failed to attach solidity object: " + error));
      return Promise.reject("Failed to attach solidity object: " + error);
    }
  } else {
    return Promise.reject("No table found");
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
