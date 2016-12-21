import "./enums/Permissions.sol";
import "./enums/Roles.sol";
import "./libs/Administered.sol";
import "./UserManager.sol";

/**
  * Admin Interface for PermissionManager, exposing the userManager pointer
*/
contract IAdminPM {
  UserManager public userManager;
}

/**
  * Manager of role-based-permissions
*/
contract PermissionManager is Permissions, Roles, Administered {
  mapping (uint => PermissionEnum[]) data;
  mapping (bytes32 => uint) dataMap;


  /**
    * Constructor
  */
  function PermissionManager() {
    add(RoleEnum.RIG, PermissionEnum.VIEW_RIG_DASHBOARD);
    add(RoleEnum.RIG, PermissionEnum.ACQUIRE_SAMPLE);

    add(RoleEnum.OFFICE, PermissionEnum.VIEW_OFFICE_DASHBOARD);
    add(RoleEnum.OFFICE, PermissionEnum.PLAN_SAMPLE);

    add(RoleEnum.RIG, PermissionEnum.LOGIN);
    add(RoleEnum.OFFICE, PermissionEnum.LOGIN);
    add(RoleEnum.VENDOR, PermissionEnum.LOGIN);
    add(RoleEnum.RIG, PermissionEnum.VIEW_SAMPLE);
    add(RoleEnum.OFFICE, PermissionEnum.VIEW_SAMPLE);
    add(RoleEnum.VENDOR, PermissionEnum.VIEW_SAMPLE);
  }


  /**
    * Add a new role-based permission. Internal method only (for now)
    * @param role {RoleEnum} - Role receiving permission
    * @param permission {PermissionEnum} - permission being assigned to role
  */
  function add(RoleEnum role, PermissionEnum permission) internal {
    uint roleId = uint(role);

    if (data[roleId].length == 0)
      data[roleId].length = 1;

    uint mappingId = data[roleId].length;
    bytes32 hash = sha3(roleId, uint(permission));

    // If role-permission already recorded, throw
    if (dataMap[hash] > 0) throw;

    dataMap[hash] = mappingId;
    data[roleId].push(permission);
  }

  /**
    * Check whether a role has a permission
    * @param role {RoleEnum} - role to check
    * @param permission {PermissionEnum} - permission to check
    * @return {bool} - whether or not the role has the permission
  */
  function hasPermission(RoleEnum role, PermissionEnum permission) constant returns (bool) {
    return dataMap[sha3(uint(role), uint(permission))] > 0;
  }

  /**
    * Return the number of permissions for a given username
    * @param role {RoleEnum} - role to lookup for permission count
    * @return {uint} - number of permissions associated with the role
  */
  function permissionCount(RoleEnum role) constant returns (uint) {
    uint length = data[uint(role)].length;
    if (length > 0) length--;
    return length;
  }

  function getPermission(RoleEnum role, uint index) returns (PermissionEnum) {
    return data[uint(role)][index + 1];
  }

  /**
    * Return the permissions associated with a username
    * @param username {bytes32} - username to lookup
    * @return {PermissionEnum[]} - array of permissions associated with the user's role
  */
  function get(bytes32 username) constant returns (PermissionEnum[]) {
    RoleEnum role = IAdminPM(getAdmin()).userManager().getRole(username);
    uint length = permissionCount(role);
    PermissionEnum[] memory results = new PermissionEnum[](length);
    for (uint i = 0; i < length; i++) {
      results[i] = data[uint(role)][i + 1];
    }
    return results;
  }
}
