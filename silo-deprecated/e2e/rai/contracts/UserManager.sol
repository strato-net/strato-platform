import "./libs/Administered.sol";
import "./libs/JsonUtils.sol";
import "./enums/Roles.sol";
import "./enums/Permissions.sol";
import "./data/User.sol";
import "./WellManager.sol";
import "./OrganizationManager.sol";

contract IPermissionManager is Permissions, Roles, Administered {
  function getPermission(RoleEnum, uint) returns (PermissionEnum);
  function permissionCount(RoleEnum) constant returns (uint);
}

/**
  * Admin Interface for UserManager, exposing the wellManager contract
*/
contract IAdminUM {
  OrganizationManager public organizationManager;
  WellManager public wellManager;
  IPermissionManager public permissionManager;
}

/**
  * Interface for User data contracts
*/
contract UserManager is JsonUtils, Roles, Permissions, Administered {
  User[] data;
  mapping (bytes32 => uint) dataMap;
  address public testAddress;

  /**
    * Constructor
  */
  function UserManager() {
    data.length = 1;
  }

  /**
    * Check if a username is available
    * @param username {bytes32} - username to check for
    * @return {bool} - whether or not the username is available
  */
  function isNameAvailable(bytes32 username) returns (bool) {
    return dataMap[username] == 0;
  }

  /**
    * Add a new user
    * @param username {bytes32} - name of new user
    * @param role {RoleEnum} - role to be assigned
    * @param addr {address} - address of the user account
    * @param pwHash {bytes32} - password hash of new user
    * @return {uint} - the id of the new user
  */
  function add(bytes32 username, RoleEnum role, address addr, bytes32 pwHash, string orgName) returns (uint userId) {
    // throw if orgname doesn't exist
    //if (!IAdminUM(getAdmin()).organizationManager().exists(orgName)) throw;
    userId = data.length;
    dataMap[username] = userId;
    data.push(new User(username, role, addr, pwHash, orgName));
  }

  /**
    * Get the role assigned to a username
    * @param username {bytes32} - name of user
    * @return {RoleEnum} - Role assigned to the user
  */
  function getRole(bytes32 username) constant returns (RoleEnum) {
    var (, role, , ) = data[dataMap[username]].get();
    return role;
  }

  /**
    * Get the string name of a user's organization
    * @param username {bytes32} - name of user to lookup
    * @return {string} - org name to be returned
  */
  function getOrgName(bytes32 username) constant returns (string) {
    uint orgNameLenth = data[dataMap[username]].getOrgNameLength();
    bytes memory orgName = new bytes(orgNameLenth);
    for (uint i = 0; i < orgNameLenth; i++) {
      orgName[i] = data[dataMap[username]].getOrgNameChar(i);
    }
    return string(orgName);
  }

  /**
    * Get the attributes of a given username
    * @param username {bytes32} - name of user to lookup
    * @return {bytes32, RoleEnum, address, bytes32} - user attributes to be returned
  */
  function get(bytes32 username) constant returns (bytes32, RoleEnum, address, bytes32, string) {
    return getByIndex(dataMap[username]);
  }

  /**
    * Get the user id
    * @param username {bytes32} - name of user to lookup
    * @return {uint} - index of the user in the data array
  */
  function getIndex(bytes32 username) constant returns (uint) {
    return dataMap[username];
  }

  /**
    * Get the user attributes from the data index
    * @param id {uint} - data index of the user to lookup
    * @return {bytes32, RoleEnum, address, bytes32} - attributes of the user
  */
  function getByIndex(uint id) constant returns (bytes32, RoleEnum, address, bytes32, string) {
    var (u, r, o, p) = data[id].get();
    return (u, r, o, p, getOrgName(u));
  }

  /**
    * Get the address of the user data contract
    * @param id {uint} - data index of the user to lookup
    * @return {address} - user data contract address
  */
  function getAddress(uint id) constant returns (address) {
    return address(data[id]);
  }

  /**
    * Get the number of wells assigned to a user
    * @param username {bytes32} - name of the user to lookup
    * @return {uint} - number of wells assigned to the user2
  */
  function getWellCount(bytes32 username) constant returns (uint) {
    return data[dataMap[username]].wellCount();
  }

  /**
    * Return the well ID from a given index of a user's assigned wells
    * @param username {bytes32} - name of the user to lookup
    * @param wellIndex {uint} - index of the well in assignedWells
    * @return {uint} - well ID assigned at the user's assignedWells wellIndex
  */
  function getWell(bytes32 username, uint wellIndex) constant returns (uint) {
    return data[dataMap[username]].getWell(wellIndex);
  }

  /**
    * Assign well to a user
    * @param username {bytes32} - name of the user
    * @param wellName {string} - name of the well to assign to the user
  */
  function assignWell(bytes32 username, string wellName) returns (bool) {
    // verify the well exists
    if (IAdminUM(getAdmin()).wellManager().getId(wellName) == 0) throw;
    data[dataMap[username]].assignWell(IAdminUM(getAdmin()).wellManager().getId(wellName));
    return true;
  }

  /**
    * Get a json array for wells assigned to a user
    * @param username {bytes32} - name of the user
    * @return {string} - json array of wells assigned to the user
  */
  function getWellsForUser(bytes32 username) constant returns (string) {
    uint wellCount = getWellCount(username);
    bytes[] memory array = new bytes[](wellCount - 1);

    for (uint i = 1; i < wellCount; i++) {
      uint wellId = getWell(username, i);
      uint wellNameLength = IAdminUM(getAdmin()).wellManager().getWellNameLength(wellId);
      bytes memory name = new bytes(wellNameLength);
      for (uint j = 0; j < wellNameLength; j++) {
        name[j] = IAdminUM(getAdmin()).wellManager().getWellNameChar(wellId, j);
      }
      array[i - 1] = name;
    }
    return getJsonArray(array);
  }

  /**
    * Return the permissions associated with a username
    * @param username {bytes32} - username to lookup
    * @return {PermissionEnum[]} - array of permissions associated with the user's role
  */
  function getPermissionsForUser(bytes32 username) constant returns (PermissionEnum[]) {
    RoleEnum role = getRole(username);
    uint length = IAdminUM(getAdmin()).permissionManager().permissionCount(role);
    PermissionEnum[] memory permissions = new PermissionEnum[](length);
    for (uint i = 0; i < length; i++) {
      permissions[i] = IAdminUM(getAdmin()).permissionManager().getPermission(role, i);
    }
    return permissions;
  }

  /**
    * Return whether a well is assigned to a user
    * @param username {bytes32} - name of the user
    * @param wellName {string} - name of the well to check
    * @return {bool} - whether the well is assigned
  */
  function isAssignedToWell(bytes32 username, string wellName) constant returns (bool) {
    return data[dataMap[username]].isAssignedToWell(IAdminUM(getAdmin()).wellManager().getId(wellName));
  }
}
