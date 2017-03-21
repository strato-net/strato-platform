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
const Promise = common.Promise;


describe('Cirrus - Contract Searchable Test', function(){
  this.timeout(120*1000);

  const scope = {};
  const adminName = util.uid('Admin');
  const contractName = util.uid('SimpleStorage');
  const contractFilename = './fixtures/search/SimpleStorage.sol';
  const compileList = [{
    searchable: [],
    contractName : contractName
  }];
  const data1 = util.uid('data1');
  const data2 = util.uid('data2');
  const batchSize = 5;

  before(function(done){
    rest.setScope(scope)
      .then(rest.createUser(adminName, config.password))
      .then(rest.getContractString(contractName, contractFilename))
      .then(function(scope){
        scope.contracts[contractName].string = scope.contracts[contractName].string.replace(new RegExp('SimpleStorage','g'),contractName);
        return scope;
      })
      .then(rest.compile(compileList))
      .then(rest.uploadContract(adminName, config.password, contractName, { _x : data1 }))
      .then(function(scope){
        done();
      })
      .catch(done);
  })

  it('Should not be able to query', function(done){
    rest.query(contractName)(scope)
      .then(function(scope){
        //this should never execute
        var result = scope.query.slice(-1)[0];
        expect(result.length).to.equal(0);
        done();
      }, function(err){
        expect(err).to.be.defined;
        expect(err.message.indexOf('404')).to.equal(0);
        done();
      })
      .catch(done);
  });

  it('Should make contract searchable, upload and query past data', function(done){
    compileList[0].searchable.push(contractName);
    rest.compile(compileList)(scope)
      .then(rest.uploadContract(adminName, config.password, contractName, { _x : data2 }))
      .then(rest.query(contractName + '?x=in.' + data1 + ',' + data2))
      .then(function(scope){
        var result = scope.query.slice(-1)[0];
        expect(result.length).to.equal(2);
        expect(result[0].x).to.equal(data2);
        expect(result[1].x).to.equal(data1);
        done();
      })
      .catch(done);
  });
});
