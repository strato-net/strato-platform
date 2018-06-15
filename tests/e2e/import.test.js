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
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute method call', function*() {
    this.timeout(config.timeout);
    const contractPath = './import/regular/A.sol';
    const contractName = 'A';
    const methodName = 'test';

    const contractA = yield rest.uploadContract(alice, contractName, contractFilename(contractPath));
    const callTest = yield rest.callMethod(alice, contractA, methodName);

    assert.equal(callTest, contractName, 'should return expected string');
  });
});

describe('ImportAndUpload - regular', function() {

  var alice;

  before(function*() {
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute method call of imported parent contract', function*() {
    this.timeout(config.timeout);
    const contractBPath = './import/regular/B.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const methodName = 'test';

    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath));
    const callTest = yield rest.callMethod(alice, contractB, methodName);

    assert.equal(callTest, contractAName, 'should return expected string');
  });
});

describe('ImportAndUpload - transitive', function() {

  var alice;

  before(function*() {
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute method call of imported parent contract', function*() {
    this.timeout(config.timeout);
    const contractCPath = './import/transitive/C.sol';
    const contractAName = 'A'
    const contractCName = 'C';
    const methodName = 'test';

    const contractC = yield rest.uploadContract(alice, contractCName, contractFilename(contractCPath));
    const callTest = yield rest.callMethod(alice, contractC, methodName);

    assert.equal(callTest, contractAName, 'should return expected string');
  });
});

describe('ImportAndUpload - relative', function() {

  var alice;

  before(function*() {
    const uid = util.uid();
    const password = '1234';
    const aliceName = 'Alice' + uid;
    alice = yield rest.createUser(aliceName, password);
  })

  it('should compile, upload, execute parent method call of relative imported child contracts', function*() {
    this.timeout(config.timeout);
    const contractCPath = './import/relative/dir/C.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const contractCName = 'C';
    const methodName = 'test';

    const contractC = yield rest.uploadContract(alice, contractCName, contractFilename(contractCPath));
    const callTest = yield rest.callMethod(alice, contractC, methodName);

    assert.equal(callTest, contractBName, 'should return expected string');
  });

  it('should compile, upload, execute parent method call of relative imported parent contracts', function*() {
    this.timeout(config.timeout);
    const contractAPath = './import/relative/A.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const methodName = 'test';

    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath));
    const callTest = yield rest.callMethod(alice, contractA, methodName);

    assert.equal(callTest, contractBName, 'should return expected string');
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
    const contractAPath = './import/circular/A.sol';
    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath));

    const contractBPath = './import/circular/B.sol';
    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath));

    const stateA = yield rest.getState(contractA);
    const stateB = yield rest.getState(contractB);

    assert.isOk(stateA.test !== undefined, 'should compile and upload contract C');
    assert.isOk(stateB.test !== undefined, 'should compile and upload contract D');
  });

  it.skip('should call methods from contract with circular dependencies, Bug API-11 https://blockapps.atlassian.net/browse/API-11', function*() {
    this.timeout(config.timeout);
    const methodName = 'test';
    const methodNameC = 'testC';
    const methodNameD= 'testD';

    const contractAPath = './import/circular/A.sol';
    const contractA = yield rest.uploadContract(alice, contractAName, contractFilename(contractAPath));

    const contractBPath = './import/circular/B.sol';
    const contractB = yield rest.uploadContract(alice, contractBName, contractFilename(contractBPath));

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