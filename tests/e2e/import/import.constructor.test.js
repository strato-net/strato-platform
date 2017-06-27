const ba = require('blockapps-rest');
require('co-mocha');
const rest = ba.rest;
const common = ba.common;
const util = common.util;
const config = common.config;
const assert = common.assert;
const path = require('path');


// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

const contractFilename = (name) => {return path.join(config.contractsPath, name)};

describe('ImportAndUpload - smoke', function() {

  var alice;

  before(function*() {
    this.timeout(config.timeout);
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute method call', function*() {
    this.timeout(config.timeout);
    const contractPath = './importConstructor/regular/A.sol';
    const contractName = 'A';
    const methodName = 'test';

    const contractA = yield rest.uploadContract(alice, contractName, contractFilename(contractPath), {set: contractName});

    const state = yield rest.getState(contractA);
    assert.equal(state.value, contractName, 'should set instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractA, methodName);
    assert.equal(callTest, contractName, 'should call method');
  });
});

describe('ImportAndUpload - regular', function() {

  var alice;

  before(function*() {
    this.timeout(config.timeout);
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute method call of imported contract', function*() {
    this.timeout(config.timeout);
    const contractBPath = './importConstructor/regular/B.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const methodName = 'test';

    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath), {set: contractBName});

    const state = yield rest.getState(contractB);
    assert.equal(state.bValue, contractBName, 'should set instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractB, methodName);
    assert.equal(callTest, contractAName, 'should call parent method');
  });
});

describe('ImportAndUpload - transitive', function() {

  var alice;

  before(function*() {
    this.timeout(config.timeout);
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute method call of imported contract', function*() {
    this.timeout(config.timeout);
    const contractCPath = './importConstructor/transitive/C.sol';
    const contractAName = 'A';
    const contractCName = 'C';
    const methodName = 'test';

    const contractC = yield rest.uploadContract(alice, contractCName, contractFilename(contractCPath), {set: contractCName});

    const state = yield rest.getState(contractC);
    assert.equal(state.cValue, contractCName, 'should set instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractC, methodName);
    assert.equal(callTest, contractAName, 'should call parent method');
  });
});

describe('ImportAndUpload - relative', function() {

  var alice;

  before(function*() {
    this.timeout(config.timeout);
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute parent method call of relative imported child contracts', function*() {
    this.timeout(config.timeout);
    const contractCPath = './importConstructor/relative/dir/C.sol';
    const contractBName = 'B';
    const contractCName = 'C';
    const methodName = 'test';

    const contractC = yield rest.uploadContract(alice, contractCName, contractFilename(contractCPath), {set: contractCName});

    const state = yield rest.getState(contractC);
    assert.equal(state.cValue, contractCName, 'should set instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractC, methodName);
    assert.equal(callTest, contractBName, 'should call parent method');
  });

  it('should compile, upload, execute parent method call of relative imported parent contracts', function*() {
    this.timeout(config.timeout);
    const contractAPath = './importConstructor/relative/A.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const methodName = 'test';

    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath), {set: contractAName});
    const state = yield rest.getState(contractA);
    assert.equal(state.aValue, contractAName, 'should set instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractA, methodName);
    assert.equal(callTest, contractBName, 'should call parent method');
  });
});

describe('ImportAndUpload - circular', function() {

  var alice;
  const contractAName = 'C';
  const contractBName = 'D';
  const contractAValue = 1;
  const contractBValue = 2;

  before(function*() {
    this.timeout(config.timeout);
    /* CREATE USER */
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  });

  it('should upload circularly dependent contracts',function*() {
    this.timeout(config.timeout);
    /* UPLOAD CONTRACTS */
    const contractAPath = './importConstructor/circular/A.sol';
    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath), {set: contractAValue});

    const contractBPath = './importConstructor/circular/B.sol';
    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath), {set: contractBValue});

    const stateA = yield rest.getState(contractA);
    const stateB = yield rest.getState(contractB);

    assert.equal(stateA.value, contractAValue, 'should compile and upload contract C');
    assert.equal(stateB.value, contractBValue, 'should compile and upload contract D');
  });

  it.skip('should call methods from contract with circular dependencies, Bug API-11 https://blockapps.atlassian.net/browse/API-11', function*() {
    this.timeout(config.timeout);
    const methodName = 'test';
    const methodNameC = 'testC';
    const methodNameD= 'testD';

    const contractAPath = './importConstructor/circular/A.sol';
    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath), {set: contractAValue});

    const contractBPath = './importConstructor/circular/B.sol';
    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath), {set: contractBValue});

    var callTest = yield rest.callMethod(alice, contractA, methodName);
    const callTestD = yield rest.callMethod(alice, contractA, methodNameD);

    assert.equal(parseInt(callTest[0]), contractAValue , 'should return C.test expected uint');
    assert.equal(parseInt(callTestD[0]), contractBValue, 'should return C.testD expected uint, Bug API-11 https://blockapps.atlassian.net/browse/API-11');

    callTest = yield rest.callMethod(alice, contractB, methodName);
    const callTestC = yield rest.callMethod(alice, contractB, methodNameC);

    assert.equal(parseInt(callTest[0]), contractBValue, 'should return D.test expected uint');
    assert.equal(parseInt(callTestC[0]), contractAValue, 'should return D.testC expected uint, Bug API-11 https://blockapps.atlassian.net/browse/API-11');
  });
});