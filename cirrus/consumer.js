var Promise = require('bluebird'),
 kafka = require('kafka-node'),
 rp = require('request-promise'),
 util = require('./lib/util'),
 chalk = require('chalk'),
 _ = require('lodash/fp'),
 __ = require('lodash'),
 delayPromise = util.delayPromise,
 Consumer = kafka.Consumer;

const toSchemaString = util.toSchemaString;

const postgrestRoot = (process.env["postgrestRoot"] || "http://localhost/cirrus/search");
const blocRoot       = (process.env["blocRoot"]) || "http://localhost/bloc/v2.2";
const zookeeperConn = (process.env["zookeeper_conn"] || "zookeeper");

const delay         = (process.env.DELAY || 200);
const totalAttempts = (process.env.ATTEMPTS || 5);
const startOffset   = (process.env.OFFSET || 0);
const fetchMaxMegabytes = (process.env.FETCHMAX_MB || 15); // unit megabytes

const emptyStringHash = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

var count =  0;

function start() {
  return function(scope) {
    return new Promise((resolve, reject) => {
      console.log("Connections are:\n\tpostgrest: "
        + postgrestRoot
        + "\n\tzookeeper: "
        + zookeeperConn
        + "\n\tbloc: "
        + blocRoot
      );

      var client = new kafka.Client(zookeeperConn);
      const payloads = [{
        topic: scope.kafkaTopic,
        offset: startOffset,
        partition: 0,
      }];
      const options = {
        fromOffset: true,
        fetchMaxBytes: 1024*1024*fetchMaxMegabytes,
      };
      scope.consumer = Promise.promisifyAll(new Consumer(client, payloads, options));
      scope.offset = startOffset;
      scope.isCirrusInserting = false;

      scope.consumer.on('message', consume(scope));
      scope.consumer.on('error', function (err) {
        if(err.name == "NO_NODE") {
          console.log(`Unable to connect to kafka node '${zookeeperConn}'`);
          process.exit(1);
        }
        console.log("Kafka consumer error: ", err);
      });
      resolve(scope);
    })
  }
}

function consume(scope) {
  return (m) => {
    var localScope = {pool: scope.pool};

    //ignore message if cirrus is inserting
    if(scope.isCirrusInserting) {
      count++;
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
        console.log('ignored ' + count + ' messages while inserting');
        console.log('resuming kafka fetch loop, offset is  ' + scope.offset);
        count=0;
        return localScope;
      })
      .catch(err => {
        console.log('Error found while consumer on offset: ' + m.offset, 'error is: ', err);
      })
  }

  // --Support functions for consume(scope)-- //
  function getAccountsForStateDiffss(m) {
    const state = JSON.parse(m.value);
    var accounts = {
      createdAccounts: [],
      updatedAccounts: [],
      deletedAccounts: [],
    };

    if(state.createdAccounts) {
      // remove accounts that have no code
      accounts.createdAccounts = _.omitBy(v => v.codeHash == emptyStringHash)(state.createdAccounts)
    }
    if(state.updatedAccounts) {
      // only update accounts with changed storage
      accounts.updatedAccounts = _.omitBy(v => Object.keys(v.storage).length == 0)(state.updatedAccounts)
    }
    if(state.deletedAccounts) {
      accounts.deletedAccounts = accounts.deletedAccounts
    }

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
      return getStates(accounts.createdAccounts)(scope)
        .then(states => {
          scope.createdStates = states;
          console.log('updated Accounts: ');
          return getStates(accounts.updatedAccounts)(scope);
        })
        .then(states => {
          scope.updatedStates = states;
          console.log('deleted Accounts: ');
          return getStates(accounts.deletedAccounts)(scope);
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
    return scope => {
      const accountAddrs = Object.keys(accounts);
      // console.log('addresses: ', accountAddrs);

      // DEBUG ONLY
      // for (let hash in global.contractMap) {
      //   const contract = global.contractMap[hash];
      //   console.log( 'global', hash, global.contractMap[hash].name);
      // }
      // for (let addr in accounts) {
      //   const account = accounts[addr];
      //   console.log( 'account', addr, accounts[addr].codeHash);
      // }
      // END OF DEBUG STATEMENTS
      var accountPromises = accountAddrs
        .map(addr => {
        return addressToState(accounts, addr)(scope)
          .then((o) => {
            console.log('>>>>>>>>>o',JSON.stringify(o));
            return JSON.stringify(o);
          })
          .then(JSON.parse)
          .then(cleanState)
          .then(x => {
            x.address = addr;
            x.codeHash = accounts[addr].codeHash;
            return x;
          })
          .catch(err => {
            if(err.message.includes('No table found')) {
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
        const codeHash = removeHexPrefix(state.codeHash);
        const url = postgrestRoot + '/'
                    + global.contractMap[codeHash].name;
        delete state.codeHash;
        return buildOption(state,httpMethod, url);
      });
    } else if (httpMethod === 'PATCH') {
      options = states.map(state => {
        const codeHash = removeHexPrefix(state.codeHash);
        const url = postgrestRoot + '/'
                    + global.contractMap[codeHash].name
                    + '?address=eq.' + state.address;
        delete state.codeHash;
        return buildOption(state, httpMethod, url);
      });
    } else if (httpMethod === 'DELETE') {
      options = states.map(state => {
        const codeHash = removeHexPrefix(state.codeHash);
        const url = postgrestRoot + '/'
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
        return rpRetry(option, delay, totalAttempts)
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

function getContractDetails(address) {
  return scope => {
      const options = {
        method: 'GET',
        url: blocRoot + '/contracts/contract/' + address + '/details',
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'accept': 'application/json'
        },
        json: true
      };
      return rp(options);
  }
}

function getContractState(name, address) {
  return scope => {

      const options = {
        method: 'GET',
        url: blocRoot + '/contracts/' + name + '/' + address + '/state',
        headers: {
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'accept': 'application/json'
        },
        json: true
      };
      return rp(options);
  }
}

function addressToState(accounts, address) {
  return scope => {
    let codeHash = removeHexPrefix(accounts[address].codeHash);
        addressFormatted = removeHexPrefix(address);

    let name;
    if(global.contractMap[codeHash] === undefined) {
      console.log('Codehash undefined. Retrieving contract details.');
      return getContractDetails(addressFormatted)(scope)
               .then(v => {name = v.name; return addContract(v, (s) => {}, codeHash)(scope)})
               .then(() => {console.log('Name:',name); return getContractState(name, addressFormatted)(scope)})
               .catch(err => {
                  throw new Error('No table found')
               });
    }
    else {

      const name = global.contractMap[codeHash].name;

      return getContractState(name, addressFormatted)(scope);
    }
  }
}

function addContract(contractDetails, callback, alternateHash) {
  return scope => {
    // incase the binaries are attached, remove them so we don't store
    delete contractDetails["bin"];
    delete contractDetails["bin-runtime"];

    var schema = toSchemaString(contractDetails);
    var pool = scope.pool;

    global.contractMap[contractDetails.codeHash] = contractDetails;
    if (alternateHash != contractDetails.codeHash) {
      // Why would the hashes ever differ? Because how bloch
      // compiles the contract has changed. Behaviour should
      // be the same, so we let cirrus share the xabi.
      var cloned = JSON.parse(JSON.stringify(contractDetails));
      cloned.codeHash = alternateHash;
      global.contractMap[cloned.codeHash] = cloned;
    }
    console.log("global.contractMap: " + JSON.stringify(global.contractMap));
    console.log("Schema: " + schema)

    pool.query(schema)
      .then(_ => {
        console.log("done creating new table for contract")
        console.log('Resetting the offset for kafka');
        callback(schema);
      })
      .catch(err => {
        console.log(err);
        throw new Error(err);
      })
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

function removeHexPrefix(str) {
  if (str.includes("0x")) {
    return str.slice(2);
  }
  return str;
}


module.exports = {
  start:start,
  addContract:addContract,
};
