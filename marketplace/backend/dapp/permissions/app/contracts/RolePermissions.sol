import "./Permission.sol";
import "./Role.sol";

/**
* App Chain Role Permissions
*
* Mapping of the roles to their respective permissions
*
* #see AppChainPermissionManager
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
        rolePermissions[uint(Role.MAX)] = 0;

        rolePermissions[uint(Role.ADMIN)] =
          (1 << uint(Permission.CREATE_USERMEMBERSHIP)) |
          (1 << uint(Permission.UPDATE_USERMEMBERSHIP)) |
          (1 << uint(Permission.CREATE_PRODUCT)) |
          (1 << uint(Permission.UPDATE_PRODUCT)) |
          (1 << uint(Permission.DELETE_PRODUCT)) |
          (1 << uint(Permission.CREATE_CATEGORY)) |
          (1 << uint(Permission.UPDATE_CATEGORY)) |
          (1 << uint(Permission.CREATE_SUBCATEGORY)) |
          (1 << uint(Permission.UPDATE_SUBCATEGORY)) |
          (1 << uint(Permission.CREATE_INVENTORY)) |
          (1 << uint(Permission.UPDATE_INVENTORY)) |
          (1 << uint(Permission.CREATE_ORDER)) |
          (1 << uint(Permission.UPDATE_ORDER)) |
          (1 << uint(Permission.CREATE_EVENT_TYPE)) |
          (1 << uint(Permission.CREATE_EVENT)) |
          (1 << uint(Permission.UPDATE_EVENT)) |
          (1 << uint(Permission.CERTIFY_EVENT));

        rolePermissions[uint(Role.TRADINGENTITY)] = 
          (1 << uint(Permission.CREATE_PRODUCT)) |
          (1 << uint(Permission.UPDATE_PRODUCT)) |
          (1 << uint(Permission.DELETE_PRODUCT)) |
          (1 << uint(Permission.CREATE_INVENTORY)) |
          (1 << uint(Permission.UPDATE_INVENTORY)) |
          (1 << uint(Permission.CREATE_ORDER)) |
          (1 << uint(Permission.UPDATE_ORDER)) |
          (1 << uint(Permission.CREATE_EVENT_TYPE)) |
          (1 << uint(Permission.CREATE_EVENT)) |
          (1 << uint(Permission.UPDATE_EVENT));

        rolePermissions[uint(Role.CERTIFIER)] =
          (1 << uint(Permission.CERTIFY_EVENT)); 
    }

    function getRolePermissions(Role[] _role) public view returns (uint) {
      // Get Permissions
      uint permissions=0;
      for(uint i=0; i < _role.length ; i++){
        permissions = permissions | rolePermissions[uint(_role[i])];
      }
      return permissions;
    }
}
