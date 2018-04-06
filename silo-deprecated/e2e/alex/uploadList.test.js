const ba = require('blockapps-rest');
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = require('bignumber.js');

describe('Bloc - List Upload', function() {
  this.timeout(40 * 1000);

  const scope = {};
  const adminName = util.uid('Admin');
  const adminPassword = '1234';
  const contractName = 'Storage';
  const contractFilename = './fixtures/Storage.sol';
  const contractArgs = {_key:123, _value:456};

  before(function(done) {
    rest.setScope(scope)
      .then(rest.createUser(adminName, adminPassword))
      .then(rest.getContractString(contractName, contractFilename))
      .then(rest.uploadContract(adminName, adminPassword, contractName, contractArgs))
      .then(function(scope) {
        done();
      }).catch(done);
  });

  const contracts = []
  contracts.push({'contractName':'Storage', 'args':{'_key': '1', '_value': '11'}});
  contracts.push({'contractName':'Storage', 'args':{'_key': '2', '_value': '22'}});

  it('should send list of contracts - with resolve ' + contracts.length + ' contracts', function(done) {
    const txresolve = false;
    rest.setScope(scope)
      .then(rest.uploadContractList(adminName, contracts, txresolve))
      .then(function(scope) {
//        rest.pp(scope);
        done();
      }).catch(done);
  });
});
