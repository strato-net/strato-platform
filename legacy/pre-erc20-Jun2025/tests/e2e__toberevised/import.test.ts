import * as path from 'path';

import {
  OAuthUser,
  BlockChainUser,
  Options,
  Contract,
  Config,
  rest,
  util,
  fsUtil,
  oauthUtil,
  assert,
  importer
  } from 'blockapps-rest';

let config:Config = fsUtil.getYaml("config.yaml");
let options:Options = {config};

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

const contractFilename = (name) => {return path.join(config.contractsPath, name)};

describe('ImportAndUpload - smoke', function() {
  this.timeout(config.timeout);

  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  })

  it('should compile, upload, execute method call', async() => {
    const contractPath = './import/regular/A.sol';
    const contractName = 'A';
    const methodName = 'test';

    const contractA = <Contract> await rest.createContract(alice, {name: contractName, source: await importer.combine(contractFilename(contractPath)), args: {}}, options);
    const callTest = await rest.call(alice, {contract: contractA, method: methodName, args: {}}, options);

    assert.equal(callTest, contractName, 'should return expected string');
  });
});

describe('ImportAndUpload - regular', function() {
  this.timeout(config.timeout);

  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  })

  it('should compile, upload, execute method call of imported parent contract', async() => {
    const contractBPath = './import/regular/B.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const methodName = 'test';

    const contractB = <Contract> await rest.createContract(alice, {name: contractBName, source: await importer.combine(contractFilename(contractBPath)), args: {}}, options);
    const callTest = await rest.call(alice, {contract: contractB, method: methodName, args: {}}, options);

    assert.equal(callTest, contractAName, 'should return expected string');
  });
});

describe('ImportAndUpload - transitive', function() {
  this.timeout(config.timeout);

  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  })

  it('should compile, upload, execute method call of imported parent contract', async() => {
    const contractCPath = './import/transitive/C.sol';
    const contractAName = 'A'
    const contractCName = 'C';
    const methodName = 'test';

    const contractC = <Contract> await rest.createContract(alice, {name: contractCName, source: await importer.combine(contractFilename(contractCPath)), args: {}}, options);
    const callTest = await rest.call(alice, {contract: contractC, method: methodName, args: {}}, options);

    assert.equal(callTest, contractAName, 'should return expected string');
  });
});

describe('ImportAndUpload - relative', function() {
  this.timeout(config.timeout);

  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  })

  it('should compile, upload, execute parent method call of relative imported child contracts', async() => {
    const contractCPath = './import/relative/dir/C.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const contractCName = 'C';
    const methodName = 'test';

    const contractC = <Contract> await rest.createContract(alice, {name: contractCName, source: await importer.combine(contractFilename(contractCPath)), args: {}}, options);
    const callTest = await rest.call(alice, {contract: contractC, method: methodName, args: {}}, options);

    assert.equal(callTest, contractBName, 'should return expected string');
  });

  it('should compile, upload, execute parent method call of relative imported parent contracts', async() => {
    const contractAPath = './import/relative/A.sol';
    const contractAName = 'A';
    const contractBName = 'B';
    const methodName = 'test';

    const contractA = <Contract> await rest.createContract(alice, {name: contractAName, source: await importer.combine(contractFilename(contractAPath)), args: {}}, options);
    const callTest = await rest.call(alice, {contract: contractA, method: methodName, args: {}}, options);

    assert.equal(callTest, contractBName, 'should return expected string');
  });
});

describe('ImportAndUpload - circular', function() {
  this.timeout(config.timeout);

  var alice;
  const contractAName = 'C';
  const contractBName = 'D';
  const contractAValue = 1;
  const contractBValue = 2;

  before(async() => {
    /* CREATE USER */
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  });

  it('should upload circularly dependent contracts',async() => {
    /* UPLOAD CONTRACTS */
    const contractAPath = './import/circular/A.sol';
    const contractA = <Contract> await rest.createContract(alice, {name: contractAName, source: await importer.combine(contractFilename(contractAPath)), args: {}}, options);

    const contractBPath = './import/circular/B.sol';
    const contractB = <Contract> await rest.createContract(alice, {name: contractBName, source: await importer.combine(contractFilename(contractBPath)), args: {}}, options);

    const stateA = await rest.getState(alice, contractA, options);
    const stateB = await rest.getState(alice, contractB, options);

    assert.isOk(stateA.test !== undefined, 'should compile and upload contract C');
    assert.isOk(stateB.test !== undefined, 'should compile and upload contract D');
  });

  it.skip('should call methods from contract with circular dependencies, Bug API-11 https://blockapps.atlassian.net/browse/API-11', async() => {
    const methodName = 'test';
    const methodNameC = 'testC';
    const methodNameD= 'testD';

    const contractAPath = './import/circular/A.sol';
    const contractA = <Contract> await rest.createContract(alice, {name: contractAName, source: await importer.combine(contractFilename(contractAPath)), args: {}}, options);

    const contractBPath = './import/circular/B.sol';
    const contractB = <Contract> await rest.createContract(alice, {name: contractBName, source: await importer.combine(contractFilename(contractBPath)), args: {}}, options);

    var callTest = await rest.call(alice, {contract: contractA, method: methodName, args: {}}, options);
    const callTestD = await rest.call(alice, {contract: contractA, method: methodNameD, args: {}}, options);

    assert.equal(parseInt(callTest[0]), contractAValue , 'should return C.test expected uint');
    assert.equal(parseInt(callTestD[0]), contractBValue, 'should return C.testD expected uint, Bug API-11 https://blockapps.atlassian.net/browse/API-11');

    callTest = await rest.call(alice, {contract: contractB, method: methodName, args: {}}, options);
    const callTestC = await rest.call(alice, {contract: contractB, method: methodNameC, args: {}}, options);

    assert.equal(parseInt(callTest[0]), contractBValue, 'should return D.test expected uint');
    assert.equal(parseInt(callTestC[0]), contractAValue, 'should return D.testC expected uint, Bug API-11 https://blockapps.atlassian.net/browse/API-11');
  });
});