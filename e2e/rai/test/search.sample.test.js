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

describe('Storage operations ', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  const samplesArray = fsutil.yamlSafeLoadSync('./test/samples.yaml');

  var sampleData = samplesArray.samples[0];
  var args = {};

  //create and upload contracts
  args = sampleData;
  for (var i = 0; i < 3; i++) {
    args.buid = args.buid + i;
    if (i%2 === 0) {
      args.wellName = 'well2';
    }
    if (i%3 === 0) {
      args.wellName = 'well3';
    }
    const contract = new Contract('Sample', './contracts/data/Sample.sol', args);
    itShould.importAndUploadBlob(alice, contract);
  }


  var search = new Search('Sample');
  itShould.search(search);
  it('should get a list of contract states with name ' + search.name, function(done) {
    assert.ok(Array.isArray(search.states));
    done();
  });

  const reducedStatePropeties = ['currentVendor', 'sampleType', 'currentState',
  'currentLocationType','buid', 'wellName'];

  itShould.searchReduced(search);
  it('should get a list of contract states with name ' + search.name + ' and reduced state properties' , function(done) {
    assert.ok(Array.isArray(search.states));
    search.states.forEach(function(item){
      reducedStatePropeties.forEach(function(prop){
        assert.ok(item.hasOwnProperty(prop));
      });
    });
    done();
  });

  itShould.searchSummary(search);
  it('should get a list of wells and the number of samples in each state in that well', function(done) {
    assert.ok(Array.isArray(search.states));
    done();
  });

  search.well = 'well1';
  itShould.searchSummary(search);
  it('should get a list of wells and the number of samples in each state in that well', function(done) {
    console.log(search.states);
    assert.ok(Array.isArray(search.states));
    assert.ok(search.states.length === 1);
    done();
  });

});
