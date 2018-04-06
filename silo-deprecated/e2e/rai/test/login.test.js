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

const raiDeployment = fsutil.yamlSafeLoadSync('./rai-deployment.yaml');
console.log('rai deployment:', raiDeployment);
assert.isDefined(raiDeployment.admin.address);

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

  const adminContract = new Contract('AdminInterface', '');
  adminContract.address = raiDeployment.AdminInterface.address;

  // get the child contracts addresses
  const permissionManagerContract = new Contract('PermissionManager', {}, {}, {});
  const userManagerContract = new Contract('UserManager', {}, {}, {});
  const wellManagerContract = new Contract('WellManager', {}, {}, {});
  itShould.getState(adminContract);
  it('should return child contract addresses', function(done) {
    assert.address(adminContract.state.permissionManager, 'PermissionManager');
    permissionManagerContract.address = adminContract.state.permissionManager;

    assert.address(adminContract.state.userManager, 'UserManager');
    userManagerContract.address = adminContract.state.userManager;

    assert.address(adminContract.state.wellManager, 'WellManager');
    wellManagerContract.address = adminContract.state.wellManager;
    done();
  });

  const username = 'Ryan';

  // get the users role
  // function getRole(bytes32 username) constant returns (RoleEnum) {
    const getRoleCall = new Call('getRole', {username: util.toBytes32(username)}, {});
    itShould.callMethod(admin, userManagerContract, getRoleCall); 
    it('should return role', function(done) {  
      console.log("The result of getRole was: ", getRoleCall.result, roleEnum[getRoleCall.result]);
      console.log("type of getRoleCall.result is: " + typeof(getRoleCall.result))
      done();
    });

  // get the users permissions
  // function get(bytes32 username) constant returns (PermissionEnum[])
  const getPermissionsCall = new Call('get', {username: util.toBytes32(username)}, {});
  itShould.callMethod(admin, permissionManagerContract, getPermissionsCall);
  it('should return an array of permissions', function(done) {
    console.log(permissionEnum);
    console.log(getPermissionsCall.result);
    const perArray = getPermissionsCall.result;
    assert.isAbove(perArray.length, 0, 'must contain at least 1 permission');
    done();
  });

  // get the users wells
  // function getWellsForUser(bytes32 username) constant returns (string)
  const getWellsCall = new Call('getWellsForUser', {username: util.toBytes32(username)}, {});
  itShould.callMethod(admin, userManagerContract, getWellsCall);
  it('should return wells array with at least one well', function(done) {
    const wellsString = util.trimNulls(getWellsCall.result); // FIXME remove ??
    const wells = JSON.parse(wellsString);
    assert.isAbove(wells.length, 0, 'must contain at least 1 well');
    done();
  });

  // get the users org
  // function getOrgName(bytes32 username) constant returns (string) {
  const getOrgCall = new Call('getOrgName', {username: util.toBytes32(username)}, {});
  itShould.callMethod(admin, userManagerContract, getOrgCall);
  it('should return org name', function(done) {
    console.log(getOrgCall.result);
    done();
  });
});
