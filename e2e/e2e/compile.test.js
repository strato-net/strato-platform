const common = require('../lib/common');
const importer = require('../lib/importer');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const should = common.should;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User;
const ContractSource = common.model.ContractSource;
const ContractSources = common.model.ContractSources;



// make an array of contract sources and contract Names
describe('Compile', function(){
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  const alice = new User(util.uid('Alice'));
  itShould.createUser(alice);

  var contractSources = new ContractSources();
  var src = `contract SimpleStorage {
                uint storedData;
                function set(uint x) {
                    storedData = x;
                }
                function get() returns (uint retVal) {
                    return storedData;
                }
            }`;
  var numSimpleStore = 4;
  for (var i=0; i<numSimpleStore; i++) {
    var contractSource = new ContractSource('SimpleStorage', src);
    contractSources.sources.push(contractSource);
  }
  // console.log(contractSources);
  var SimpleStorageCodeHash = '989ad6524e83e1a38b485bb898d27b5dbc65fc33905c3d3a2fd41c5bb91c3fc8';
  itShould.compileContracts(contractSources)
  it('Should check that correct codeHashes were returned', function() {
    assert.ok(contractSources.results.length == contractSources.sources.length, 'the results are not the correct length of: ' + contractSources.length);
    contractSources.results.forEach(function(item){
      assert.ok(item.codeHash == SimpleStorageCodeHash, 'code hashes were not correct');
    });
  });

  var multiContractSources = new ContractSources();
  var multiConctract = `contract Consumer {
                        InfoFeed feed;
                        uint global;

                        function setFeed(address addr) { feed = InfoFeed(addr); }
                        function callFeed() { global = feed.info(); }
                      }

                      contract InfoFeed {
                        function info() returns (uint ret) { return 42; }
                      }`;
  multiContractSources.sources.push(new ContractSource('Consumer',multiConctract));
  itShould.compileContracts(multiContractSources)
  it('Should check that correct number of contract codehashes were returned', function() {
    // console.log(multiContractSources.results);
    assert.ok(multiContractSources.results.length == 2, '2 results were not returned when 2 contracts were uploaded.');
  });

  var differentContracSources = new ContractSources();
  differentContracSources.sources = multiContractSources.sources.concat(contractSources.sources);
  itShould.compileContracts(differentContracSources)
  it('Should check that correct number of contract codehashes were returned', function() {
    assert.ok(differentContracSources.results.length == (2 +numSimpleStore), (differentContracSources.results.length) + ' results were not returned when' + (2 +numSimpleStore) +' contracts were uploaded.');
  });

});
