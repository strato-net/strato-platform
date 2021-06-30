import "./Permission.sol";
import "./Role.sol";

/**
* Carbon Role Permissions
*
* Mapping of the roles to their respective permissions
*
* #see CarbonPermissionManager
* #see Role
* #see Permission
*
* #return none
*/

contract RolePermissions is Role, Permission {
    uint[] rolePermissions;

    /**
    * Constructor
    */
    constructor() public {
        rolePermissions.length = uint(Role.MAX);
        rolePermissions[uint(Role.NULL)] = 0;
        rolePermissions[uint(Role.ORG_USER)] = 0;

        // Assigning permissions to Beanstalk roles
        rolePermissions[uint(Role.GLOBAL_ADMIN)] =
          (1 << uint(Permission.CREATE_ORG)) |
          (1 << uint(Permission.UPDATE_ORG)) |
          (1 << uint(Permission.CREATE_RU)) |
          (1 << uint(Permission.UPDATE_RU)) |
          (1 << uint(Permission.CREATE_USER)) |
          (1 << uint(Permission.UPDATE_USER)) |
          (1 << uint(Permission.MODIFY_MEMBERSHIP));

        rolePermissions[uint(Role.ORG_ADMIN)] =
          (1 << uint(Permission.UPDATE_ORG_LIMITED)) |
          (1 << uint(Permission.CREATE_USER_LIMITED)) |
          (1 << uint(Permission.UPDATE_USER_LIMITED));
    }

    function getRolePermissions(Role _role) public view returns (uint) {
        // Get Permissions
        return rolePermissions[uint(_role)];
    }
}
