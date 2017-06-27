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

describe('ImportAndUpload with Constructor - smoke', function() {

  var alice;

  before(function*() {
    this.timeout(config.timeout);
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  });

  it('should compile, upload, execute method call', function*() {
    this.timeout(config.timeout);
    const contractPath = './importConstructor/regular/A.sol';
    const contractName = 'A';
    const caA = 'caA';
    const methodName = 'test';

    const contractA = yield rest.uploadContract(alice, contractName, contractFilename(contractPath), {caA: caA});

    const state = yield rest.getState(contractA);
    assert.equal(state.storedA, caA, 'should set instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractA, methodName);
    assert.equal(callTest, caA, 'should call method from parent');
  });
});

describe('ImportAndUpload with Constructor - regular', function() {

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
    const contractBName = 'B';
    const caA = 'caA';
    const caB = 'caB';
    const methodName = 'test';

    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath), {caA: caA, caB: caB});

    const state = yield rest.getState(contractB);
    assert.equal(state.storedB, caB, 'should set child instance variable in constructor');
    assert.equal(state.storedA, caA, 'should set parent instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractB, methodName);
    assert.equal(callTest, caA, 'should call parent method');
  });
});

describe('ImportAndUpload with Constructor - transitive', function() {

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
    const contractCName = 'C';
    const caA = 'caA';
    const caC = 'caB';
    const methodName = 'test';

    const contractC = yield rest.uploadContract(alice, contractCName, contractFilename(contractCPath), {caA: caA, caC: caC});

    const state = yield rest.getState(contractC);
    assert.equal(state.storedC, caC, 'should set child instance variable in constructor');
    assert.equal(state.storedA, caA, 'should set parent instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractC, methodName);
    assert.equal(callTest, caA, 'should call parent method');
  });
});

describe('ImportAndUpload with Constructor - relative', function() {

  var alice;

  before(function*() {
    this.timeout(config.timeout);
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it.skip('should compile, upload, execute parent method call of relative imported child contracts, API-15 BUG: https://blockapps.atlassian.net/browse/API-15', function*() {
    this.timeout(config.timeout);
    const contractCPath = './importConstructor/relative/dir/C.sol';
    const contractCName = 'C';
    const caA = 'caA';
    const caB = 'caB';
    const caC = 'caC';
    const methodName = 'test';

    const contractC = yield rest.uploadContract(alice, contractCName, contractFilename(contractCPath), {caA: caA, caB: caB, caC: caC});

    const state = yield rest.getState(contractC);
    assert.equal(state.storedC, caC, 'should set child instance variable in constructor');
    assert.equal(state.storedB, caB, 'should set parent instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractC, methodName);
    assert.equal(callTest, caB, 'should call parent method');
  });

  it.skip('should compile, upload, execute parent method call of relative imported parent contracts, API-15 BUG: https://blockapps.atlassian.net/browse/API-15', function*() {
    this.timeout(config.timeout);
    const contractAPath = './importConstructor/relative/A.sol';
    const contractAName = 'A';
    const caA = 'caA';
    const caB = 'caB';
    const methodName = 'test';

    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath), {caA: caA, caB: caB});
    const state = yield rest.getState(contractA);
    assert.equal(state.storedA, caA, 'should set child instance variable in constructor');
    assert.equal(state.storedB, caB, 'should set parent instance variable in constructor');

    const callTest = yield rest.callMethod(alice, contractA, methodName);
    assert.equal(callTest, caB, 'should call parent method');
  });
});

describe('ImportAndUpload with Constructor - circular', function() {

  var alice;
  const contractCName = 'C';
  const contractDName = 'D';
  const caC = 1;
  const caD = 2;

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
    const contractA = yield rest.uploadContract(alice, contractCName, contractFilename(contractAPath), {caC: caC});

    const contractBPath = './importConstructor/circular/B.sol';
    const contractB = yield rest.uploadContract(alice, contractDName, contractFilename(contractBPath), {caD: caD});

    const stateA = yield rest.getState(contractA);
    const stateB = yield rest.getState(contractB);

    assert.equal(stateA.storedC, caC, 'should compile and upload contract C');
    assert.equal(stateB.storedD, caD, 'should compile and upload contract D');
  });

  it.skip('should call methods from contract with circular dependencies, Bug API-11 https://blockapps.atlassian.net/browse/API-11', function*() {
    this.timeout(config.timeout);
    const methodName = 'test';
    const methodNameC = 'testC';
    const methodNameD= 'testD';

    /* UPLOAD CONTRACTS */
    const contractAPath = './importConstructor/circular/A.sol';
    const contractA = yield rest.uploadContract(alice, contractCName, contractFilename(contractAPath), {caC: caC});

    const contractBPath = './importConstructor/circular/B.sol';
    const contractB = yield rest.uploadContract(alice, contractDName, contractFilename(contractBPath), {caD: caD});

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