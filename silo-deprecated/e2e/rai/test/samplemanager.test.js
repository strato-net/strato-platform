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


// function Sample(
//   address sampleFsmAddr,
//   uint sampleId,
//   string wellname,
//   string sampletype,
//   string currentlocationtype,
//   string currentvendor,
//   uint startdepthfeet,
//   uint enddepthfeet,
//   uint startdepthmeter,
//   uint enddepthmeter
// ) {


const raiDeployment = fsutil.yamlSafeLoadSync('./rai-deployment.yaml');
console.log('rai deployment:', raiDeployment);
assert.isDefined(raiDeployment.admin.address);

const samplesArray = fsutil.yamlSafeLoadSync('./test/samples.yaml');
console.log('samples', samplesArray.samples);
assert.isDefined(samplesArray.samples);



describe('RAI - create preset samples', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  // create ADMIN
  const admin = new User(util.uid('Admin'));
  admin.password = config.password;
  itShould.createUser(admin);

  const contractsPath = './contracts/';
  const adminContract = new Contract('AdminInterface', contractsPath + 'AdminInterface.sol');
  // const adminContract = new Contract('AdminInterface', '');
  // adminContract.address = raiDeployment.AdminInterface.address;

  // upload main contract
  itShould.importAndUploadBlob(admin, adminContract);
  itShould.getAbi(adminContract);
  it('should have a valid contract state', function(done) {
    assert.equal(adminContract.state.name, adminContract.name, 'should have the right name');
    console.log(adminContract.address);
    done();
  });


  // get the child contracts addresses
  const permissionManagerContract = new Contract('PermissionManager', {}, {}, {});
  const userManagerContract = new Contract('UserManager', {}, {}, {});
  const wellManagerContract = new Contract('WellManager', {}, {}, {});
  const sampleManagerContract = new Contract('SampleManager', {}, {}, {});
  itShould.getState(adminContract);
  it('should return child contract addresses', function(done) {
    assert.address(adminContract.state.permissionManager, 'PermissionManager');
    permissionManagerContract.address = adminContract.state.permissionManager;

    assert.address(adminContract.state.userManager, 'UserManager');
    userManagerContract.address = adminContract.state.userManager;

    assert.address(adminContract.state.wellManager, 'WellManager');
    wellManagerContract.address = adminContract.state.wellManager;

    assert.address(adminContract.state.sampleManager, 'SampleManager');
    sampleManagerContract.address = adminContract.state.sampleManager;
    done();
  });

  // state before adding samples
  itShould.getState(sampleManagerContract);

  // for all samples in preset samples file
  samplesArray.samples.forEach(function(sample) {

    var sampleContract = new Contract('Sample', './contracts/data/Sample.sol', sample);

    itShould.importAndUploadBlob(admin, sampleContract);
    itShould.getAbi(sampleContract);
    it('should have a valid contract state', function(done) {
      assert.equal(sampleContract.state.name, sampleContract.name, 'should have the right name');
      console.log('vars', sampleContract.state.xabi.vars);

      const call = new Call('addSample', {addr:sampleContract.state.address});
      const user = admin;
      const contract = sampleManagerContract;

      // add the sample to the sample manager
      api.bloc.method({
          password: config.password,
          method: call.method,
          args: call.args,
          value: 0.1,
        }, user.name, user.address, contract.name, contract.address)
        .then(function(result) {
          console.log('add', sample.address, result);
          call.result = result;
          done();
        })
        .catch(function(err) {
          if (err.data !== undefined) {
            done(new Error(err.data));
          } else {
            done(err);
          }
        });
    });
  });

  itShould.getState(sampleManagerContract);
  it('should find the addresses', function(done) {
    console.log(sampleManagerContract.state.data);
    done();
  });

  // done creating - now search
  var search = new Search('Sample');
  itShould.getContracts(search);
  it('should get a list of addresses for contract name ' + search.name, function(done) {
    console.log(search);
    assert.ok(Array.isArray(search.addresses), 'must get back an array');
    done();
  });

  itShould.getContractsState(search);
  it('should filter the search results', function(done) {
    console.log('>>>>>>>>>>>>>>>>>>> results', JSON.stringify(search, null, 2));
    assert.ok(Array.isArray(search.states), 'must get back an array');

    var byWell = filterByWell(search.states, 'well9');
    console.log('>>>>>>>>>>>>>>>>> byWell', JSON.stringify(byWell, null, 2));
    //
    // var byBuid = filterByBuid(search.states, 456);
    // console.log('>>>>>>>>>>>>>>>>> byBuid', JSON.stringify(byBuid, null, 2));
    //
    // var byState = filterByState(search.states, stateEnum.indexOf('COLLECTED'));
    // console.log('>>>>>>>>>>>>>>>>> byState', JSON.stringify(byState, null, 2));
    //
    // var byWellState = filterByWellState(search.states, 'well2', stateEnum.indexOf('COLLECTED'));
    // console.log('>>>>>>>>>>>>>>>>> byWellState', JSON.stringify(byWellState, null, 2));

    done();
  });


  function filterByWell(array, wellname) {
    return array.filter(function(item) {
      return (item.wellName == wellname);
    });
  }

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


});
