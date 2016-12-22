const common = require('../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Storage = common.model.Storage;
const Call = common.model.Call;
const Tx = common.model.Tx;
const Search = common.model.Search;
const BigNumber = common.BigNumber;
const importer = require('../lib/importer');

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

var numParents = 2;

describe('Storage operations ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  var id = 10 * process.hrtime()[1]
  var value1 = id + 1;
  var value2 = id + 2;

  const contract1 = new Contract('Storage', './fixtures/contracts/Storage.sol', {_key: id, _value: value1});
  const contract2 = new Contract('Storage', './fixtures/contracts/Storage.sol', {_key: id, _value: value2});
  const contract3 = new Contract('Storage', './fixtures/contracts/Storage.sol', {_key: id, _value: value2});
  const contractSearch = new Contract('', '', {});

  itShould.importAndUploadBlob(alice, contract1);
  itShould.importAndUploadBlob(alice, contract2);
  itShould.importAndUploadBlob(alice, contract3);

  var search = new Search(contract1.name);
  itShould.getContracts(search);
  it('should get a list of addresses for contract name ' + search.name, function(done) {
    // console.log(search);
    assert.ok(Array.isArray(search.addresses));
    done();
  });

  itShould.getContractsState(search);
  it('should filter the search results', function(done) {
    // console.log(search);
    assert.ok(Array.isArray(search.states));

    var criterias = [['key', id]];
    var filtered = util.filter(search.states, criterias);
    //console.log(filtered);
    assert.equal(filtered.length, 3, 'should have 3 search results');

    criterias = [['key', id], ['value', value2]];
    filtered = util.filter(search.states, criterias);
    //console.log(filtered);
    assert.equal(filtered.length, 2, 'should have only 2 search results');

    criterias = [['key', id], ['value', value1]];
    filtered = util.filter(search.states, criterias);
    //console.log(filtered);
    assert.equal(filtered.length, 1, 'should have only 1 search result');

    done();
  });

  // TODO: I couldn't get this to work as `getCode` requires an address to be present in the contract
  //itShould.getContracts(contract1);
  //itShould.getCode(contract1);
  // it('should query code in account', function(done){
  //   assert.notEqual(contract1.code.length, 0, 'should not be null');
  //   done();
  // })

  var code = "60606040526008565b00"
  itShould.getContractsByCode(code, contractSearch)
  it('should search for contracts by code ' + code, function(done){
    assert.notEqual(contractSearch.addresses.length, 0, 'should more than 0 results');
    done();
  })

  itShould.getContractsByCode("", contractSearch);
  it('should query code in empty account', function(done){
    assert.notEqual(contractSearch.addresses.length, 0, 'should have non-zero users');
    done();
  })

  itShould.getContractsByCode("deadbeef", contractSearch);
  it('should query code in random account', function(done){
    assert.equal(contractSearch.addresses.length, 0, 'should be null');
    done();
  })

  // see comment above why hard-coded hash
  var codeHash = "d1d29ee74a6d03244189ddb39239adc2a5f77ba91a8df459f17a172dbd96213d"
  itShould.getContractsByCodeHash(codeHash, contractSearch)
  it('should search for contracts by code ' + codeHash, function(done){
    assert.notEqual(contractSearch.addresses.length, 0, 'should more than 0 results');
    done();
  })

  var emptyHash = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
  itShould.getContractsByCodeHash(emptyHash, contractSearch);
  it('should query code in empty account', function(done){
    assert.notEqual(contractSearch.addresses.length, 0, 'should have non-zero users');
    done();
  })

  itShould.getContractsByCodeHash("deadbeef", contractSearch);
  it('should query code in random account', function(done){
    assert.equal(contractSearch.addresses.length, 0, 'should be null');
    done();
  })

});

describe('Contract-in-contract uploads Child/Parent', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const childContract = new Contract('Child', './fixtures/contractInContract/child.sol', {who: "god"});

  itShould.importAndUploadBlob(alice, childContract);
  itShould.getAbi(childContract);
  it('should have a valid contract state', function(done) {
    assert.equal(childContract.state.name, childContract.name, 'should have the right name');
    done();
  });

  const test = new Call('test', {}, 'Child');
  itShould.callMethod(alice, childContract, test);
  it('should return ' + test.expected, function(done) {
    assert.equal(test.result, test.expected, 'should return Child');
    done();
  });

  const parentContract = new Contract('Parent', './fixtures/contractInContract/parent.sol');
  itShould.importAndUploadBlob(alice, parentContract);
  itShould.getAbi(parentContract);
  it('should have a valid contract state', function(done) {
    assert.equal(parentContract.state.name, parentContract.name, 'should have the right name');
    done();
  });

  const getUint = new Call('getUint', {}, '666');
  itShould.callMethod(alice, parentContract, getUint);
  it('should return ' + getUint.expected, function(done) {
    done();
  });

  const getChild = new Call('getChild', {}, 'valid address');
  for(var i = 0; i < numParents; i++) {
    itShould.callMethod(alice, parentContract, getChild);
    it('should return ' + getChild.expected, function(done) {
      assert.ok(util.isAddress(getChild.result), 'should return address');
      childContract.address = getChild.result;
      done();
    });

    itShould.callMethod(alice, childContract, test);
    it('should return ' + test.expected, function(done) {
      assert.equal(test.result, test.expected, 'should return Child');
      done();
    });
  }
});

describe('Search state', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const stateContract1 = new Contract('State', './fixtures/search/State.sol', {});
  itShould.importAndUploadBlob(alice, stateContract1);

  const search = new Contract('Child', '', {});

  itShould.getContracts(search);
  it('should get a list of addresses for contract name ' + search.name, function(done) {
    // console.log(search);
    assert.ok(Array.isArray(search.addresses));
    done();
  });

  itShould.getContractsBySearch(search);
  it('should filter the search results', function(done) {

    var nGods = 0;
    var nParents = 0;

    // this is super ugly because I can't get Object.keys() working in getContractsBySearch()
    for(var key in search.stateMap){
      if(search.stateMap[key].state["myParent"] == "god"){
          nGods = nGods + 1;
      } else if(search.stateMap[key].state["myParent"] == "parent"){
        nParents = nParents + 1;
      }
    }

    assert.isAtLeast(nGods, 1, "should have a god");
    assert.isAtLeast(nParents, numParents, "should have a parents");

    done();
  });


  itShould.getContractsBySearch(stateContract1, {"lookup":"state1", "lookup":"state2"});
  it('should limit the search', function(done) {
    //subsequent runs of the test without resetting the deployment may cause larger result sets
    assert.isAtleast(stateContract1.stateMap.length, 2, "Two states should be returned");
    done();
  });
});
