const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const BigNumber = common.BigNumber;
const path = require('path');

describe('Compile Tests Against Bloc', function () {
  this.timeout(config.timeout);


  const contractName = "SimpleStorage";
  const contractFilename = path.join(config.contractsPath, "SimpleStorage.sol");
  const typoContractFilename = path.join(config.contractsPath, "TypoContract.sol");
  const searchableArray = [contractName]

  it('should compile the SimpleStorage contract', function* () {
    const compileResults = yield rest.compileSearch(searchableArray, contractName, contractFilename);
    assert.isOk(compileResults,'successfully compile the contract');
  });
  it('should fail to compile the SimpleStorage contract with a 400', function* () {
    let compileResults;
    try {
      compileResults = yield rest.compileSearch(searchableArray, contractName, typoContractFilename);
    } catch(e) {
      assert.equal(e.status,400, `fails with ${e.statusText}`);
    }
    assert.isUndefined(compileResults, 'nothing compiled on failure');
  });
});
