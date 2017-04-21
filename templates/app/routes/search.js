'use strict';

var express = require('express');
var helper = require('../lib/contract-helpers.js');
var router = express.Router();
var Promise = require('bluebird');
var ba = require('blockapps-js');
var Solidity = ba.Solidity;

var cors = require('cors');
var traverse = require('traverse');
var es = require('event-stream')
var rp = require('request-promise');
var dnscache = require('dnscache');

require('marko/node-require').install();

var yaml = require('js-yaml');
var fs = require('fs');
var config = yaml.safeLoad(fs.readFileSync('config.yaml'));
var apiURI = config.apiURL;

/* use dnscache during search */
dnscache({
  "enable" : true,
  "ttl" : 300,
  "cachesize" : 1000
});

/* accept header used */
router.get('/:contractName', cors(), function (req, res) {
  var contractName = req.params.contractName;
  helper.contractAddressesStream(contractName)
      .pipe( helper.collect() )
      .pipe( es.map(function (data,cb) {
        var names = data.map(function (item) {
          return item.split('.')[0];
        });

        cb(null,JSON.stringify(names));
      }))
      .pipe(res)
});

router.get('/:contractName/state', cors(), function (req, res) {
  if(typeof(req.query.lookup) !== 'object' && req.query.lookup)
    req.query.lookup = [req.query.lookup]

  getStatesFor(req.params.contractName, req.query.lookup).then(function(resp){
    res.send(resp);
  });
});

// TODO: deprecate this function
// it is now equivalent to
// `/:contractName/state?lookup=currentVendor&lookup=sampleType...`
router.get('/:contractName/state/reduced', cors(), function (req, res) {
  if (typeof(req.query.props) === 'undefined' ) {
    res.status(400).send('Bad Request: No `props` parameter in query string')
    return;
  }

  var props;

  if (typeof(req.query.props) === 'string' ) {
    props = req.query.props.split();
  } else {
    props = req.query.props;
  }

  getStatesFor(req.params.contractName, props).then(function(resp){
    res.send(resp);
  });
});

// TODO: re-write for req.query.lookup
router.get('/:contractName/state/summary', cors(), function (req, res) {
  var well = req.query.well;
  getStatesFor(req.params.contractName).then(function(resp){
    if (resp.length === 0) {
      res.send(resp);
      return;
    }
    var summary = [];
    if (well) {
      var wellSummary = {};
      var filtered = resp.filter(function(item) {
        return item.state.wellName === well;
      });
      filtered.forEach(function(item) {
        if(wellSummary[item.state.currentState.key]) {
          wellSummary[item.state.currentState.key]++;
        } else {
          wellSummary[item.state.currentState.key] = 1;
        }
      });
      summary.push(wellSummary)
    } else {

      // Get all well names
      var wells = [];
      resp.forEach(function(item){
        if (!wells.includes(item.state.wellName)) {
          wells.push(item.state.wellName);
        }
      });

      wells.forEach(function(item){
        var wellSummary = {};
        wellSummary[item] = {};

        resp.forEach(function(sample) {
          if (sample.state.wellName === item) {
            if (wellSummary[item][sample.state.currentState.key]) {
              wellSummary[item][sample.state.currentState.key]++;
            } else {
              wellSummary[item][sample.state.currentState.key] = 1;
            }
          }
        });
        summary.push(wellSummary);
      });
    }
    res.send(summary);
  });
});

function getStatesFor(contract, reducedState) {


  var contractName = contract;
  var found = false;

  var addresses;
  var promise;
  var masterContract = {};
  return new Promise(function (resolve, reject) {
    var results = helper.contractsMetaAddressStream(contractName, 'Latest');
    if(results === null){
      console.log("couldn't find any contracts");
      resolve([]);
    } else {
      results.pipe( es.map(function (data,cb) {
        if (data.name === contractName) {
          found = true;
          // console.log(data);
          masterContract = JSON.stringify(data);
          cb(null,data["codeHash"]);
        }
        else cb();
      }))

      .pipe( es.map(function (data, cb) {
        // resolve(data);
        var options = {
          method: 'GET',
          uri: apiURI + '/eth/v1.2/account?codeHash=' + data ,
          // form: {
          //   code: data
          // },
        }
        rp(options)
          .then(function (result) {
            // console.log('obtained result from /eth/v1.2/account/codeHash');
            cb(null, JSON.parse(result));
          })
          .catch(function (err) {
            console.log("rp failure", err);
            cb(null, err)
          });
      }))

      .pipe( es.map(function (data,cb) {
        // console.log('data',data)
        addresses = data.map(function (item) {
          return item.address;
        });
        // console.log('addresses', addresses);
        cb(null,addresses);
      }))

      .on('data', function(data) {
        var items = data;
        var payloads = [];
        // var delay = 0;
        for(var i=0; i < items.length; i++) { //items.length
          var item = items[i];
          var contractData = JSON.parse(masterContract);
          contractData.address = item;
          var contract = Solidity.attach(contractData);

          payloads.push({contract:contract, reducedState:reducedState, attempt:0});

          // var promise = DelayPromise(delay, payload).then(function(payload) {
          //   return buildContractState(payload.contract, payload.reducedState, payload.attempt);
          // });
          // delay += 15;
          // promises.push(promise);

        }

        var maxRequests = 200;
        var contractVars= JSON.parse(masterContract).xabi.vars;

        //if contract has no state variables
        if(!contractVars){
          // set numVars to 1 to set burstSize == maxRequests
          numVars = 1;
        } else {
          var numVars = Object.keys(contractVars).length;
        }
        var burstSize;

        if(reducedState) {
          numVars = reducedState.length;
        }

        if (maxRequests > numVars) {
          burstSize = Math.floor(maxRequests / numVars);
        } else {
          burstSize = 1;
        }

        // for(var i=0; i< 10000000; i++){
        //   if(i==0) {
        //     console.log('length is :', Object.keys(contractVars).length);
        //   }
        // }
        // var burstSize = 1000;
        promise = processArray(payloads,burstSize).then(function(results){
          // console.log([].concat.apply([], results));
          return [].concat.apply([], results);
        });

      })

      .on('end', function () {

        if (!found) {
          resolve([]);
        }
        else {
          // Promise.all(promises).then(function(resp){
          //   resolve(resp);
          // }).catch(function(err){
          //   reject(err);
          // });
          promise.then(function(resp){

            resolve(resp);
          }).catch(function(err){
            reject(err);
          });
        }
      });
    }
  });

}

function buildContractState(contract, reducedState, attempt) {
  if(reducedState){
    var tempState = {};
    reducedState.forEach(function(x){
      tempState[x] = contract.state[x];
    })
    contract.state = tempState;
  }

  return Promise.props(contract.state).then(function(sVars) {

    // console.log("finished calling blockapps-js: " + globalVar + " address is: " + contract.account.address)
    // globalVar += 1;
    var parsed = traverse(sVars).forEach(function (x) {

      if (Buffer.isBuffer(x)) {
        this.update(x.toString());
      }
    });

    var stateAndAddress = {};
    stateAndAddress.address = contract.account.address;
    stateAndAddress.state = parsed;
    return stateAndAddress;
  })
  .catch(function(err) {
    console.log("contract/state sVars - error: " + err);
    if(attempt < 30) {
      console.log('attempt: ', attempt);
      return new Promise(function(resolve, _) {
        setTimeout(function(){
          console.log("re-Attempting with address: " + contract.account.address)
          resolve(buildContractState(Solidity.attach(contract.detach()), reducedState, attempt + 1));
        }, 500);
      });
    }
  });
}

// function DelayPromise(delay, payload) {
//   return new Promise(function(resolve, _) {
//     setTimeout(function() {
//       resolve(payload);
//     }, delay);
//   });
// }

function processBursts(bursts, results) {
  return new Promise(function(resolve){
    // console.log(bursts);
    if(bursts.length == 0) {
      resolve(results);
      return;
    }

    var burst = bursts.pop();

    processBurst(burst, results).then(function(result){
      // console.log('finished burst, beginning next burst');
      results.push(result);
      resolve(processBursts(bursts, results));
    });
  });
}

function processBurst(burst) {
  var promises = [];
  // console.log('processing burst');
  burst.forEach(function(item){
    promises.push(processItem(item));
  });

  return Promise.all(promises,function(results){
    // console.log('Finished processing burst');
    return results;
  });
}

function processItem(payload) {
  return buildContractState(payload.contract, payload.reducedState, payload.attempt);
}

function processArray(array, burstSize) {
  var bursts = [];

  for (var i = 0; i < array.length; i+=burstSize) {
    var burst = [];
    for (var j = 0; j < burstSize; j++) {
      if(array[i+j]) {
        burst.push(array[i+j]);
      }
      if(j > array.length) {
        break;
      }
    }
    bursts.push(burst);
  }
  // console.log('processing all bursts');
  return processBursts(bursts, []);
}


module.exports = router;
