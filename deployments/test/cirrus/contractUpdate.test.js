const ba = require('blockapps-rest');
const cirrus = require('./cirrus')();
const rest = ba.rest;
const common = ba.common;
const config = common.config;
const util = common.util;
const fsutil = common.fsutil;
const should = common.should;
const assert = common.assert;
const expect = common.expect;
const BigNumber = require('bignumber.js');
const Promise = common.Promise;


describe('Cirrus - Contract Update Test', function(){
  this.timeout(120*1000);

  const scope = {};
  const adminName = util.uid('Admin');
  const contractFilenameV1 = './fixtures/search/SampleManager.sol';
  const contractFilenameV2 = './fixtures/search/SampleManager_v2.sol';
  const contractName = 'SampleManager';
  const compileList = [{
    searchable: ['Sample'],
    contractName : contractName
  }];
  const locationV1 = util.uid('v1');
  const locationV2 = util.uid('v2');
  const batchSize = 5;
  const delay = 2000; //wait for cirrus to catch up;

  before(function(done){
    rest.setScope(scope)
      .then(rest.createUser(adminName, config.password))
      .then(function(scope){
        done();
      })
      .catch(done);
  });

  it('Should upload and query original contract', function(done){
    rest.getContractString(contractName, contractFilenameV1)(scope)
      .then(rest.uploadContract(adminName, config.password, contractName, {}))
      .then(rest.compile(compileList))
      .then(function(scope){
        const txs = cirrus.getBatchTx(contractName, scope.contracts[contractName].address, 0, batchSize, locationV1, 1);
        return rest.callMethodList(adminName, txs, true)(scope);
      })
      .then(cirrus.delayPromise(delay))
      .then(rest.query('Sample?currentLocationType=eq.' + locationV1))
      .then(function(scope){
        var result = scope.query.slice(-1)[0];
        expect(result.length).to.equal(batchSize);
        expect(result[0].sampleState).to.be.undefined;
        done();
      })
      .catch(done);
  });

  it('Should upload and query new contract', function(done){
    rest.getContractString(contractName, contractFilenameV2)(scope)
      .then(rest.uploadContract(adminName, config.password, contractName, {}))
      .then(rest.compile(compileList))
      .then(function(scope){
        const txs = cirrus.getBatchTx(contractName, scope.contracts[contractName].address, 0, batchSize, locationV2, 2);
        return rest.callMethodList(adminName, txs, true)(scope);
      })
      .then(cirrus.delayPromise(delay))
      .then(rest.query('Sample?currentLocationType=eq.' + locationV2))
      .then(function(scope){
        var result = scope.query.slice(-1)[0];
        expect(result.length).to.equal(batchSize);
        expect(result[0].sampleState).to.be.defined;
        expect(result[0].sampleState).to.equal('New');
        done();
      })
      .catch(done);
  });

  it('Should query original records and confirm new property', function(done){
    rest.query('Sample?currentLocationType=eq.' + locationV1)(scope)
      .then(function(scope){
        var result = scope.query.slice(-1)[0];
        expect(result.length).to.equal(batchSize);
        expect(result[0].sampleState).to.be.defined;
        expect(result[0].sampleState).to.equal('');
        done();
      })
      .catch(done);
  });

});
