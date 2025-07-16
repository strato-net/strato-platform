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
let options:Options = {config: {...config, VM: "SolidVM"}};

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

const contractFilename = (name) => {return path.join(config.contractsPath, name)};

describe('ImportAndUpload with Constructor - smoke', function() {
  this.timeout(config.timeout);
  
  let ouser
  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  });

  it('should compile, upload, execute method call', async() => {
    const contractPath = './importConstructor/regular/A.sol';
    const contractName = 'A';
    const caA = 'caA';
    const methodName = 'test';

    const contractA = <Contract> await rest.createContract(alice, {name: contractName, source: fsUtil.get(contractFilename(contractPath)), args: {caA: caA}}, options);

    const state = await rest.getState(alice, contractA, options);
    assert.equal(state.storedA, caA, 'should set instance variable in constructor');

    const callTest = await rest.call(alice, {contract: contractA, method: methodName, args: {}}, options);
    assert.equal(callTest, caA, 'should call method from parent');
  });
});

describe('ImportAndUpload with Constructor - regular', function() {
  this.timeout(config.timeout);
  
  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  });

  it('should compile, upload, execute method call of imported contract', async() => {
    const contractBPath = './importConstructor/regular/B.sol';
    const contractBName = 'B';
    const caA = 'caA';
    const caB = 'caB';
    const methodName = 'test';

    const fullSource = await importer.combine(contractFilename(contractBPath));

    const contractB = <Contract>await rest.createContract(alice, {name: contractBName, source: fullSource, args: {caA: caA, caB: caB}}, options);

//    const state = await rest.getState(alice, contractB, options);
//    assert.equal(state.storedB, caB, 'should set child instance variable in constructor');
//    assert.equal(state.storedA, caA, 'should set parent instance variable in constructor');

//    const callTest = await rest.call(alice, {contract: contractB, method: methodName, args: {}}, options);
//    assert.equal(callTest, caA, 'should call parent method');
  });
});

describe('ImportAndUpload with Constructor - transitive', function() {
  this.timeout(config.timeout);
  
  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  });

  it('should compile, upload, execute method call of imported contract', async() => {
    const contractCPath = './importConstructor/transitive/C.sol';
    const contractCName = 'C';
    const caA = 'caA';
    const caC = 'caB';
    const methodName = 'test';

    const fullSource = await importer.combine(contractFilename(contractCPath));

    const contractC = <Contract>await rest.createContract(alice, {name: contractCName, source: fullSource, args: {caA: caA, caC: caC}}, options);

    const state = await rest.getState(alice, contractC, options);
    assert.equal(state.storedC, caC, 'should set child instance variable in constructor');
    assert.equal(state.storedA, caA, 'should set parent instance variable in constructor');

    const callTest = await rest.call(alice, {contract: contractC, method: methodName, args: {}}, options);
    assert.equal(callTest, caA, 'should call parent method');
  });
});

describe('ImportAndUpload with Constructor - relative', function() {

  this.timeout(config.timeout);
  
  var alice;

  before(async() => {
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  });

  it.skip('should compile, upload, execute parent method call of relative imported child contracts, API-15 BUG: https://blockapps.atlassian.net/browse/API-15', async() => {
    const contractCPath = './importConstructor/relative/dir/C.sol';
    const contractCName = 'C';
    const caA = 'caA';
    const caB = 'caB';
    const caC = 'caC';
    const methodName = 'test';

    const fullSource = await importer.combine(contractFilename(contractCPath));

    const contractC = <Contract>await rest.createContract(alice, {name: contractCName, source: fullSource, args: {caA: caA, caB: caB, caC: caC}}, options);

    const state = await rest.getState(alice, contractC, options);
    assert.equal(state.storedC, caC, 'should set child instance variable in constructor');
    assert.equal(state.storedB, caB, 'should set parent instance variable in constructor');

    const callTest = await rest.call(alice, {contract: contractC, method: methodName, args: {}}, options);
    assert.equal(callTest, caB, 'should call parent method');
  });

  it.skip('should compile, upload, execute parent method call of relative imported parent contracts, API-15 BUG: https://blockapps.atlassian.net/browse/API-15', async() => {
    const contractAPath = './importConstructor/relative/A.sol';
    const contractAName = 'A';
    const caA = 'caA';
    const caB = 'caB';
    const methodName = 'test';

    const fullSource = await importer.combine(contractFilename(contractAPath));

    const contractA = <Contract>await rest.createContract(alice, {name: contractAName, source: fullSource, args: {caA: caA, caB: caB}}, options);
    const state = await rest.getState(alice, contractA, options);
    assert.equal(state.storedA, caA, 'should set child instance variable in constructor');
    assert.equal(state.storedB, caB, 'should set parent instance variable in constructor');

    const callTest = await rest.call(alice, {contract: contractA, method: methodName, args: {}}, options);
    assert.equal(callTest, caB, 'should call parent method');
  });
});

describe('ImportAndUpload with Constructor - circular', function() {
  this.timeout(config.timeout);
  
  var alice;
  const contractCName = 'C';
  const contractDName = 'D';
  const caC = 1;
  const caD = 2;

  before(async() => {
    /* CREATE USER */
    const oauth:oauthUtil = await oauthUtil.init(config.nodes[0].oauth);
    let ouser:OAuthUser = await oauth.getAccessTokenByClientSecret();
    alice = await rest.createUser(ouser, options);
  });

  it('should upload circularly dependent contracts', async() => {
    /* UPLOAD CONTRACTS */
    const contractAPath = './importConstructor/circular/A.sol';
    const contractA = <Contract>await rest.createContract(alice, {name: contractCName, source: await importer.combine(contractFilename(contractAPath)), args: {caC: caC}}, options);

    const contractBPath = './importConstructor/circular/B.sol';
    const contractB = <Contract>await rest.createContract(alice, {name: contractDName, source: await importer.combine(contractFilename(contractBPath)), args: {caD: caD}}, options);

    const stateA = await rest.getState(alice, contractA, options);
    const stateB = await rest.getState(alice, contractB, options);

    assert.equal(stateA.storedC, caC, 'should compile and upload contract C');
    assert.equal(stateB.storedD, caD, 'should compile and upload contract D');
  });

  it.skip('should call methods from contract with circular dependencies, Bug API-11 https://blockapps.atlassian.net/browse/API-11', async() => {
    const methodName = 'test';
    const methodNameC = 'testC';
    const methodNameD= 'testD';

    /* UPLOAD CONTRACTS */
    const contractAPath = './importConstructor/circular/A.sol';
    const contractA = <Contract>await rest.createContract(alice, {name: contractCName, source: await importer.combine(contractFilename(contractAPath)), args: {caC: caC}}, options);

    const contractBPath = './importConstructor/circular/B.sol';

    const fullSource = await importer.combine(contractFilename(contractBPath));

    const contractB = <Contract>await rest.createContract(alice, {name: contractDName, source: fullSource, args: {caD: caD}}, options);

    var callTest = await rest.call(alice, {contract: contractA, method: methodName, args: {}}, options);
    const callTestD = await rest.call(alice, {contract: contractA, method: methodNameD, args: {}}, options);

    let contractAValue = undefined;
    let contractBValue = undefined;

    assert.equal(parseInt(callTest[0]), contractAValue , 'should return C.test expected uint');
    assert.equal(parseInt(callTestD[0]), contractBValue, 'should return C.testD expected uint, Bug API-11 https://blockapps.atlassian.net/browse/API-11');

    callTest = await rest.call(alice, {contract: contractB, method: methodName, args: {}}, options);
    const callTestC = await rest.call(alice, {contract: contractB, method: methodNameC, args: {}}, options);

    assert.equal(parseInt(callTest[0]), contractBValue, 'should return D.test expected uint');
    assert.equal(parseInt(callTestC[0]), contractAValue, 'should return D.testC expected uint, Bug API-11 https://blockapps.atlassian.net/browse/API-11');
  });
});
