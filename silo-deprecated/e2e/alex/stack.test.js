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

function increment(adminName, contractName, _index) {
  return function(scope) {
    // function set(uint index)
    const method = 'increment';
    const args = {
      index: _index,
    };
    return rest.callMethod(adminName, contractName, method, args)(scope)
      .then(function(scope) {
        return scope;
      });
  }
}

function factoryCreateCalls(contractName, count) {
  return function(scope) {
    verbose('factoryCreateContract', {
      contractName,
      count
    });
    var array = [];
    const address = scope.contracts[contractName].address;
    for (var i = 0; i < count; i++) {
      array.push({
        'contractName': contractName,
        'contractAddress': address,
        'methodName': 'increment',
        'value': 0.1,
        'args': {
          index: i,
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
  const contractName = 'Stack';
  const contractFilename = './fixtures/Stack.sol';
  const count = 200;

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

  it.skip('should increment the stack manually', function(done) {
    const address = scope.contracts[contractName].address;
    rest.setScope(scope)
      .then(increment(adminName, contractName, 0))
      .then(increment(adminName, contractName, 1))
      .then(increment(adminName, contractName, 2))
      .then(rest.getState(contractName, address))
      .then(function(scope) {
        const data = scope.states[contractName].data;
        assert.equal(data.length, 3);
        assert.ok(data[0] == 0);
        assert.ok(data[1] == 1);
        assert.ok(data[2] == 2);
        done();
      }).catch(done);
  });

  it('should send list of calls - with resolve ', function(done) {
    const address = scope.contracts[contractName].address;
    const txresolve = true;
    const calls = scope.contracts[contractName].calls;
    rest.setScope(scope)
      .then(rest.callMethodList(adminName, calls, txresolve))
      .then(rest.getState(contractName, address))
      .then(function(scope) {
        const data = scope.states[contractName].data;
        assert.equal(data.length, count);
        for (var i = 0; i < count; i++) {
          assert.equal(data[i], i, `location ${i} contains ${data[i]}`);
        }
        done();
      }).catch(done);
  });

});
