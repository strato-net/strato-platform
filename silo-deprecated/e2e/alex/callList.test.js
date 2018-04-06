const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = common.BigNumber;
const verbose = rest.verbose;

function factoryCreateCalls(contractName, count) {
  return function(scope) {
    verbose('factoryCreateContract', {contractName, count});
    var array = [];
    const address = scope.contracts[contractName].address;
    for (var i = 0; i < count; i++) {
      array.push({
        'contractName': contractName,
        'contractAddress': address,
        'methodName': 'set',
        'value': 1,
        'args': {
          x: i
        }
      });
    }
    scope.contracts[contractName].calls = array;
    return scope;
  }
}

describe('Bloc - List Upload', function() {
  this.timeout(40 * 1000);

  const scope = {};
  var adminName = util.uid('Admin');
  const adminPassword = '1234';
  const contractName = 'SimpleStorage';
  const contractFilename = './fixtures/SimpleStorage.sol';
  const count = 3;

  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(adminName, adminPassword))
      .then(rest.getContractString(contractName, contractFilename))
      .then(rest.uploadContract(adminName, adminPassword, contractName))
      .then(factoryCreateCalls(contractName, count))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  // test-scripts · 132922485_transaction-batching± ⟩ curl -X POST -H "Content-type: application/json" -d '{"password": "1234", "txs": [{"contractName":"SimpleStorage", "contractAddress":"7b10b7f518e4890de0151beb86cc24cd08cbbd54", "methodName":"set", "value":"4", "args":{"x":"1"}}, {"contractName":"SimpleStorage", "contractAddress":"7b10b7f518e4890de0151beb86cc24cd08cbbd54", "methodName":"set", "value":"5", "args":{"x":"2"}}], "resolve":"false"}' 40.84.53.181:8001/users/Alice_3955_87442142/cfe2a8e6fb47628989bccbaf021c59df2dbbf307/callList -s | json_pp
  // [
  //    "c5917420d970ea60880c9e1e343678c717b4cf93cf915bf0a8ae25e3ba83aa21",
  //    "d8a2e88ee3b999733c3679b58e7962102cf246a1cefd67ff0e6a48882638a1ee"
  // ]

  it('should send list of calls - no resolve', function(done) {
    const txresolve = false;
    const calls = scope.contracts[contractName].calls;
    rest.setScope(scope)
      .then(rest.callMethodList(adminName, calls, txresolve))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  it('should send list of calls - with resolve ', function(done) {
    const txresolve = true;
    const calls = scope.contracts[contractName].calls;
    rest.setScope(scope)
      .then(rest.callMethodList(adminName, calls, txresolve))
      .then(function(scope) {
        done();
      }).catch(done);
  });
});
