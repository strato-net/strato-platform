import "/blockapps-sol/lib/auth/permission/contracts/PermissionManager.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

import "./Permission.sol";
import "./RolePermissions.sol";
import "./Role.sol";

/**
* App Chain Permissions Manager
*
* Entry point to grant and revoke permissions for a user on the app chain. Also check whether a
* user has permission to perform a particular actions or not.
*
* #see RolePermission
* #see Role
* #see Permission
*
* #return none
*/

contract AppPermissionManager is RestStatus, PermissionManager, Permission, RolePermissions {
    /**
    * Constructor
    */
    constructor(address _admin, address _master)
    public
    PermissionManager(_admin, _master) {}

    function grantRole(string _id, address _address, Role[] _role) public returns (uint, uint) {
        // Get permission for a role
        uint permissions = getRolePermissions(_role);
        // Get current user permissions
        var (restStatus, userPermissions) = getPermissions(_address);

        // TODO incorrect commented code, Should check for the correct permission status and the if the user already has existing permissions before making the change
        // if (restStatus == RestStatus.OK) {
        //     if (userPermissions > 0) {
        //         return (RestStatus.CONFLICT, userPermissions);
        //     }
        // }
        // Grant role to a user
        if (permissions == 0) {
            return (RestStatus.OK, userPermissions);
        }
        return grant(_id, _address, permissions);
    }

    function upsertRole(string _id, address _address, Role[] _role) public returns (uint, uint) {
        // Get permission for a role
        uint permissions = getRolePermissions(_role);
        // Get current user permissions
        // var (restStatus, userPermissions) = getPermissions(_address);

        // TODO incorrect commented code, Should check for the correct permission status and the if the user already has existing permissions before making the change
        // if (restStatus == RestStatus.OK) {
        //     if (userPermissions > 0) {
        //         return (RestStatus.CONFLICT, userPermissions);
        //     }
        // }
        // Grant role to a user
        if (permissions == 0) {
            return (RestStatus.OK, permissions);
        }
        return applyPermission(_id, _address, permissions);
    }

    function revoke(address _address) public returns (uint) {
        return super.revoke(_address);
    }

    function canCreateUserMembership(address _address) public returns(bool){
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_USERMEMBERSHIP);
        // Check permission
        return check(_address,permissions) == RestStatus.OK;
    }

    function canUpdateUserMembership(address _address) public returns(bool){
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_USERMEMBERSHIP);
        // Check permission
        return check(_address,permissions) == RestStatus.OK;
    }

    function canCreateProduct(address _address) public returns(bool){
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_PRODUCT);
        // Check permission
        return check(_address,permissions) == RestStatus.OK;
    }

    function canUpdateProduct(address _address) public returns(bool){
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_PRODUCT);
        // Check permission
        return check(_address,permissions) == RestStatus.OK;
    }

     function canDeleteProduct(address _address) public returns(bool){
        // Get permission
        uint permissions = 1 << uint(Permission.DELETE_PRODUCT);
        // Check permission
        return check(_address,permissions) == RestStatus.OK;
    }
    
    function canCreateCategory(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_CATEGORY);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canUpdateCategory(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_CATEGORY);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canCreateSubCategory(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_SUBCATEGORY);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

    function canUpdateSubCategory(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_SUBCATEGORY);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }

     function canCreateInventory(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_INVENTORY);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }


     function canUpdateInventory(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_INVENTORY);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
    }


     function canCreateOrder(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_ORDER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
     }

     function canUpdateOrder(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_ORDER);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
     }

    function canCreateEventType(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_EVENT_TYPE);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
     }

     function canCreateEvent(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CREATE_EVENT);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
     }


     function canUpdateEvent(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.UPDATE_EVENT);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
     }

     
     function canCertifyEvent(address _address) public returns (bool) {
        // Get permission
        uint permissions = 1 << uint(Permission.CERTIFY_EVENT);
        // Check permission
        return check(_address, permissions) == RestStatus.OK;
     }
}
