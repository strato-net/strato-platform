pragma solidvm 3.0;

import "./Permission.sol";
import "./Role.sol";

/**
* Network Onboarding Role Permissions
*
* Mapping of the roles to their respective permissions
*
* #see NetworkOnboardingPermissionManager
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

        // Assigning permissions to roles
        rolePermissions[uint(Role.NETWORK_ADMIN)] =
          (1 << uint(Permission.INVITE_ORG)) |
          (1 << uint(Permission.CREATE_ORG)) |
          (1 << uint(Permission.REMOVE_ORG)) |
          (1 << uint(Permission.CREATE_USER)) |
          (1 << uint(Permission.UPDATE_ROLE_NETWORK));

        rolePermissions[uint(Role.ORG_ADMIN)] =
          (1 << uint(Permission.REQUEST_JOIN_APP)) |
          (1 << uint(Permission.INVITE_JOIN_APP)) |
          (1 << uint(Permission.CREATE_APP)) |
          (1 << uint(Permission.INVITE_JOIN_ORG)) |
          (1 << uint(Permission.CREATE_USER)) |
          (1 << uint(Permission.UPDATE_ROLE_ORG));
    }

    function getRolePermissions(Role _role) public view returns (uint) {
        // Get Permissions
        return rolePermissions[uint(_role)];
    }
}
