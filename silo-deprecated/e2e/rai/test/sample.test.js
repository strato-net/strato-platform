const common = require('../../lib/common');
const config = common.config;
const constants = common.constants;
const api = common.api;
const assert = common.assert;
const util = common.util;
const itShould = common.itShould;
const User = common.model.User
const Contract = common.model.Contract;
const Call = common.model.Call;
const Tx = common.model.Tx;
const Search = common.model.Search;
const BigNumber = common.BigNumber;
const fsutil = common.fsutil;

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------


// address sampleFsmAddr,
// uint sampleId,
// string wellname,
// string sampletype,
// string currentlocationtype,
// string currentvendor,
// uint startdepthfeet,
// uint enddepthfeet,
// uint startdepthmeter,
// uint enddepthmeter

function createSample(sampleId, state) {
  return {
    sampleFsmAddr: 1234,
    state: state,
    sampleId: sampleId,
    wellname: 'wellname',
    sampletype: 'sampletype',
    currentlocationtype: 'currentlocationtype',
    currentvendor: 'currentvendor',
    startdepthfeet: 12,
    enddepthfeet: 23,
    startdepthmeter: 34,
    enddepthmeter: 45,
  };
}

const raiDeployment = fsutil.yamlSafeLoadSync('./rai-deployment.yaml');
const samplesArray = fsutil.yamlSafeLoadSync('./test/samples.yaml');

console.log('samples', samplesArray.samples);

const contractsPath = './fixtures/contracts/';
const stateEnum = common.eparser.getEnumsSync(contractsPath + 'enums/SampleState.sol').SampleStateEnum;

describe('RAI - create preset samples', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  // create ADMIN
  const admin = new User(util.uid('Admin'));
  admin.password = config.password;
  itShould.createUser(admin);

  const sampleFsmContract = new Contract('SampleFsm', './fixtures/contracts/SampleFsm.sol');
  itShould.importAndUploadBlob(admin, sampleFsmContract);

  // for all samples in preset samples file
  samplesArray.samples.forEach(function(sample) {

    var sampleContract = new Contract('SampleV1', './fixtures/contracts/data/SampleV1.sol', sample);
    // pass the FSM address to Sample
    //  sampleContract.args.sampleFsmAddr = sampleFsmContract.address;

    itShould.importAndUploadBlob(admin, sampleContract);
    itShould.getAbi(sampleContract);
    it('should have a valid contract state', function(done) {
      assert.equal(sampleContract.state.name, sampleContract.name, 'should have the right name');
      console.log(sampleContract.state.xabi.vars);
      done();
    });
  });

  // done creating - now search
  var search = new Search('SampleV1');
  itShould.getContracts(search);
  it('should get a list of addresses for contract name ' + search.name, function(done) {
    console.log(search);
    assert.ok(Array.isArray(search.addresses), 'must get back an array');
    done();
  });

  itShould.getContractsState(search);
  it('should filter the search results', function(done) {
    // console.log('>>>>>>>>>>>>>>>>>>> results', JSON.stringify(search, null, 2));
    assert.ok(Array.isArray(search.states), 'must get back an array');
    var byBuid = filterByBuid(search.states, 456);
    console.log('>>>>>>>>>>>>>>>>> byBuid', JSON.stringify(byBuid, null, 2));

    var byState = filterByState(search.states, stateEnum.indexOf('COLLECTED'));
    console.log('>>>>>>>>>>>>>>>>> byState', JSON.stringify(byState, null, 2));

    var byWellState = filterByWellState(search.states, 'well2', stateEnum.indexOf('COLLECTED'));
    console.log('>>>>>>>>>>>>>>>>> byWellState', JSON.stringify(byWellState, null, 2));

    done();
  });
});

function filterByBuid(array, buid) {
  return array.filter(function(item) {
    return (item.id == buid);
  });
}

function filterByState(array, state) {
  return array.filter(function(item) {
    return (item.currentState.value == state);
  });
}

function filterByWellState(array, wellName, state) {
  return array.filter(function(item) {
    return (item.wellName == wellName && item.currentState.value == state);
  });
}

// describe.skip('RAI - create preset samples', function() {
//   this.timeout(config.timeout);
//   itShould.checkAvailability(); // in case bloc crashed on the previous test
//
//   // create ADMIN
//   const admin = new User(util.uid('Admin'));
//   admin.password = config.password;
//   itShould.createUser(admin);
//
//   const adminContract = new Contract('AdminInterface', '');
//   adminContract.address = raiDeployment.AdminInterface.address;
//
//   // get the child contracts addresses
//   const permissionManagerContract = new Contract('PermissionManager', {}, {}, {});
//   const userManagerContract = new Contract('UserManager', {}, {}, {});
//   const wellManagerContract = new Contract('WellManager', {}, {}, {});
//   const sampleManagerContract = new Contract('SampleManager', {}, {}, {});
//   itShould.getState(adminContract);
//   it('should return child contract addresses', function(done) {
//     assert.address(adminContract.state.permissionManager, 'PermissionManager');
//     permissionManagerContract.address = adminContract.state.permissionManager;
//
//     assert.address(adminContract.state.userManager, 'UserManager');
//     userManagerContract.address = adminContract.state.userManager;
//
//     assert.address(adminContract.state.wellManager, 'WellManager');
//     wellManagerContract.address = adminContract.state.wellManager;
//
//     assert.address(adminContract.state.sampleManager, 'SampleManager');
//     sampleManagerContract.address = adminContract.state.sampleManager;
//     done();
//   });
//
//
//   // function add(
//   //   string wellname,
//   //   string sampletype,
//   //   string currentlocationtype,
//   //   string currentvendor,
//   //   uint startdepthfeet,
//   //   uint enddepthfeet,
//   //   uint startdepthmeter,
//   //   uint enddepthmeter
//   // ) returns (uint sampleId) {
//
//   function createSample() {
//     return {
//       wellname: 'wellname',
//       sampletype: 'sampletype',
//       currentlocationtype: 'currentlocationtype',
//       currentvendor: 'currentvendor',
//       startdepthfeet: 10,
//       enddepthfeet: 37,
//       startdepthmeter: 10 / 3.28084,
//       enddepthmeter: 37 / 3.28084,
//     };
//   }
//
//   const sample = createSample();
//   const addCall = new Call('add', sample);
//   itShould.callMethod(admin, sampleManagerContract, addCall); 
//   it('should return sample id', function(done) {
//     console.log(addCall.result);
//     assert.ok(addCall.result > 0, 'sample id should be > 0');
//     done();
//   });
// });
//
// const contract = new Contract('Sample');
// var search = new Search(contract.name);
//
// itShould.getContracts(search);
// it('should get a list of addresses for contract name ' + search.name, function(done) {
//   console.log(search);
//   assert.ok(Array.isArray(search.addresses));
//   done();
// });
//
// itShould.getContractsState(search);
// it('should filter the search results', function(done) {
//   console.log(search);
//   assert.ok(Array.isArray(search.states));
//
//   var criterias = [
//     ['wellname', 'wellname']
//   ];
//   var filtered = util.filter(search.states, criterias);
//   console.log(filtered);
//   assert.equal(filtered.length, 3, 'should have 3 search results');
//
//   done();
// });
