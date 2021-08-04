// pragma solidvm 3.0;

import "/blockapps-sol/lib/auth/permission/contracts/PermissionManager.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

import "./Permission.sol";
import "./RolePermissions.sol";
import "./Role.sol";

/**
* Network Onboarding Permissions Manager
*
* Entry point to grant and revoke role for a user. Also check whether a
* user has permission to perform a particular actions or not.
*
* #see RolePermission
* #see Role
* #see Permission
*
* #return none
*/

contract NetworkOnboardingPermissionManager is RestStatus, PermissionManager, Permission, RolePermissions {
    /**
    * Constructor
    */
    constructor(address _admin, address _master)
    public
    PermissionManager(_admin, _master) {}

    function grantRole(string _id, address _address, Role _role) public returns (uint, uint) {
        // Get permission for a role
        uint permissions = getRolePermissions(_role);
        // Get current user permissions
        var (restStatus, userPermissions) = getPermissions(_address);
        if (restStatus == RestStatus.OK) {
            if (userPermissions > 0) {
                return (RestStatus.CONFLICT, userPermissions);
            }
        }
        // Grant role to a user
        if (permissions == 0) {
            return (RestStatus.OK, userPermissions);
        }
        return grant(_id, _address, permissions);
    }

    function revoke(address _address) public returns (uint) {
        return super.revoke(_address);
    }

    function canInviteOrganization(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.INVITE_ORG);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canCreateOrganization(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_ORG);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canRemoveOrganization(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.REMOVE_ORG);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canRequestToJoinApplication(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.REQUEST_JOIN_APP);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canInviteToJoinApplication(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.INVITE_JOIN_APP);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canCreateApplication(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_APP);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canInviteToJoinOrganization(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.INVITE_JOIN_ORG);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }
    
    // Create an user as part of your organization
    function canCreateOrgUser(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_ORG_USER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    // Create any user as part of any organization
    function canCreateAnyUser(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_ANY_USER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canReadOrgUser(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.READ_ORG_USER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canReadAnyUser(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.READ_ANY_USER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canUpdateUser(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_USER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canUpdateRoleInNetwork(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_ROLE_NETWORK);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canUpdateRoleInOrganization(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_ROLE_ORG);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }
}
