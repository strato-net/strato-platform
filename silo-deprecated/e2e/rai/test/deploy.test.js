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
const BigNumber = common.BigNumber;
const fsutil = common.fsutil;

// ---------------------------------------------------
//   test suites
// ---------------------------------------------------

// Create User				manual/CLI	10 users
// Assign Role				manual	3
// Create Well				manual	1
// Assign Well(s)				manual	to all users

const raiConfig = fsutil.yamlSafeLoadSync('./test/rai-config.yaml');
assert.isDefined(raiConfig, 'Rai Config read failed');
console.log('RAI config', JSON.stringify(raiConfig, null, 2));

const contractsPath = './contracts/';
const roleEnum = common.eparser.getEnumsSync(contractsPath + 'enums/Roles.sol').RoleEnum;
assert.isDefined(roleEnum, 'Role enum read failed');
const permissionEnum = common.eparser.getEnumsSync(contractsPath + 'enums/Permissions.sol').PermissionEnum;
assert.isDefined(permissionEnum, 'Permission enum read failed');

describe('RAI - deploy system', function() {
  this.timeout(config.timeout);
  itShould.checkAvailability(); // in case bloc crashed on the previous test

  // create ADMIN
  const admin = new User(util.uid('Admin'));
  admin.password = config.password;
  itShould.createUser(admin);
  const adminContract = new Contract('AdminInterface', contractsPath+ 'AdminInterface.sol');
  // upload main contract
  itShould.importAndUploadBlob(admin, adminContract);
  itShould.getAbi(adminContract);
  it('should have a valid contract state', function(done) {
    assert.equal(adminContract.state.name, adminContract.name, 'should have the right name');
    console.log(adminContract.address);
    done();
  });

  // get the child contracts addresses
  const permissionContract = new Contract('PermissionManager', {}, {}, {});
  const userManagerContract = new Contract('UserManager', {}, {}, {});
  const wellManagerContract = new Contract('WellManager', {}, {}, {});
  const orgManagerContract = new Contract('OrganizationManager', {}, {}, {});
  itShould.getState(adminContract);
  it('should return child contract addresses', function(done) {
    assert.address(adminContract.state.permissionManager, 'PermissionManager');
    permissionContract.address = adminContract.state.permissionManager;

    assert.address(adminContract.state.userManager, 'UserManager');
    userManagerContract.address = adminContract.state.userManager;

    assert.address(adminContract.state.wellManager, 'WellManager');
    wellManagerContract.address = adminContract.state.wellManager;

    assert.address(adminContract.state.organizationManager, 'OrganizationManager');
    orgManagerContract.address = adminContract.state.organizationManager;

    done();
  });

  // create wells
  itShould.getState(wellManagerContract);
  raiConfig.wells.forEach(function(well) {
    // call method add on wellManager
    // function add(string name, string wellHeadBUID, string boreHoleBUID)
    const call = new Call('add', {name: well.name, wellHeadBUID: well.wellHeadBUID, boreHoleBUID: well.boreHoleBUID}, 'null');
    itShould.callMethod(admin, wellManagerContract, call); 
  });
  itShould.getState(wellManagerContract);
  it('should return the right wells count ' + raiConfig.wells.length, function(done) {
    // the data array contains 1 empty member at index 0
    assert.equal(wellManagerContract.state.data.length, raiConfig.wells.length+1, 'should return the expected value');  
    done();
  });

  itShould.getState(orgManagerContract);

  // create addresses
  raiConfig.orgs.forEach(function(org) {
    // function Address(string _fullName, string _street, string _city, string _state, string _zip) {
    var addressContract = new Contract('Address', contractsPath+ 'data/Address.sol', org.shippingAddress);
    itShould.importAndUploadBlob(admin, addressContract);
    itShould.getAbi(addressContract);
    it('should have a valid contract state', function(done) {
      assert.equal(addressContract.state.name, addressContract.name, 'should have the right name');

      // function add(string orgName, OrganizationTypeEnum orgType, Address shippingAddress) nameAvailable(orgName)
      var call = new Call('addFix', {orgName: org.name, orgType: org.type, shippingAddress: addressContract.address}, 'null');
      var user = admin;
      var contract = orgManagerContract;

      return api.bloc.method({
          password: admin.password,
          method: call.method,
          args: call.args,
          value: 0.1,
        }, user.name, user.address, contract.name, contract.address)
        .then(function(result) {
          call.result = result;
          done();
        }).catch(done);
    });
  });
  itShould.getState(orgManagerContract);

  // Create Users - Blockapps
  itShould.getState(userManagerContract);
  raiConfig.users.forEach(function(user) {
    it('should create user ' + user.name, function(done) {
      return api.bloc.createUser({
          faucet: '1',
          password: config.password,
        }, user.name)
        .then(function(address) {
          assert.address(address);
          user.address = address;

          var role = roleEnum.indexOf(user.role);
          assert.ok(role >=1 && role <=3);
          // function add(bytes32 username, RoleEnum role, address addr, bytes32 pwHash, string orgName) returns (uint userId) {
          var call = new Call('add', {username: util.toBytes32(user.name), role: role, addr: user.address, pwHash:util.toBytes32(user.password), orgName: 'org1'}, 'null');
          var contract = userManagerContract;

          return api.bloc.method({
              password: config.password,
              method: call.method,
              args: call.args,
              value: 0.1,
            }, user.name, user.address, contract.name, contract.address)
            .then(function(result) {
              call.result = result;
              done();
            }).catch(done);
        }).catch(done);
    });
  });

  // // Create Users - RAI
  // itShould.getState(userManagerContract);
  // raiConfig.users.forEach(function(user) {
  //   // call method add on userManager
  //   // function add(bytes32 username, RoleEnum r, address addr, bytes32 p) returns (uint userId) {
  //   var role = roleEnum.indexOf(user.role);
  //   assert.ok(role >=1 && role <=3);
  //   var call = new Call('add', {username: util.toBytes32(user.name), r: role, addr: usersArray[user.name], p:util.toBytes32(user.password)}, 'null');
  //   itShould.callMethod(admin, userManagerContract, call); 
  // });
  itShould.getState(userManagerContract);
  it('should return the right user count ' + raiConfig.users.length, function(done) {  
    // the data array contains 1 empty member at index 0
    assert.equal(userManagerContract.state.data.length, raiConfig.users.length+1, 'should return the expected value');  
    done();
  });

  // assign wells to users
  itShould.getState(userManagerContract);
  raiConfig.users.forEach(function(user) {
    user.wells.forEach(function(well) {
      // call method assignWell on userManager
      // function assignWell(bytes32 username, string wellName)
      const call = new Call('assignWell', {username: util.toBytes32(user.name), wellName:well}, 'true');
      itShould.callMethod(admin, userManagerContract, call); 
      it('should return true', function(done) {  
        assert.equal(call.result, call.expected, 'should return true');  
        done();
      });
    });
  });
  itShould.getState(userManagerContract);

  // get roles
  raiConfig.users.forEach(function(user) {
    // function getRole(bytes32 username) constant returns (RoleEnum) {
    const call = new Call('getRole', {username: util.toBytes32(user.name)}, {});
    itShould.callMethod(admin, userManagerContract, call); 
    it('should return role', function(done) {  
      console.log(call.result);
      done();
    });
  });

  // get permission per role.
  itShould.getState(permissionContract);
  raiConfig.users.forEach(function(user) {
    // function hasPermission(RoleEnum role, PermissionEnum permission) constant returns (bool) {
    var permission = permissionEnum.indexOf('VIEW_RIG_DASHBOARD');
    var role = roleEnum.indexOf(user.role);
    const call = new Call('hasPermission', {role: role, permission: permission}, {});
    itShould.callMethod(admin, permissionContract, call); 
    it('should return permission for role:' + roleEnum[role] + ' permission:' + permissionEnum[permission], function(done) {  
      console.log(call.result);
      done();
    });
  });

  it('should write the deployment config', function(done) {
    const object = {admin: admin, AdminInterface: {address: adminContract.address}, users:raiConfig.users};
    fsutil.yamlWrite(object, './rai-deployment.yaml' );
    done();
  });
});
