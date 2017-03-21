const common = require('../../lib/common');
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
const fsutil = common.fsutil;
const importer = require('../../lib/importer');

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

describe('Contract in Contract', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  //Create
  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const time = process.hrtime()[1].toString();

  const productName = 'Product' + time;
  const factoryName = 'Factory' + time;
  const productFunction = 'get' + time;

  const productSol = 'contract ' + productName + ' { uint item; function ' + productName + '() { item = ' + time +'; } '
    + ' function ' + productFunction + '() returns(uint) { return ' + time +'; } }';
  const factorySol = 'contract ' + factoryName + ' { ' + productName + '[] products; '
    + 'function makeProduct() { ' + productName + ' a = new ' + productName + '(); products.push(a); } }'
    + productSol;


  var factoryContract = new Contract(factoryName);
  factoryContract.string =  factorySol;
  var productContract = new Contract(productName);
  productContract.string = productSol;
  var args = {};

  itShould.uploadContract(alice,factoryContract);
  itShould.uploadContract(alice,productContract);

  let numberOfProducts = 100;
  // //create and upload contracts
  for (var i = 0; i < numberOfProducts - 1; i++) {
    const call = new Call('makeProduct');
    itShould.callMethod(alice, factoryContract, call)
  }
  //

  itShould.getAbi(productContract);
  var search = new Search(productName);
  itShould.search(search);
  it('should get a list of contract states with name ' + search.name, function(done) {
    assert.ok(Array.isArray(search.states));
    console.log('Found ' + search.states.length + ' contracts with name ' + search.name);
    assert.ok(search.states.length === numberOfProducts);
    done();
  });

  var search2 = new Search('random');
  itShould.search(search2);
  it('should fail since there is no contract random', function(done) {
    assert.ok(Array.isArray(search2.states));
    assert.ok(search2.states.length === 0);
    done();
  });


});
