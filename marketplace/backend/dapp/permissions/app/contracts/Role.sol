/**
* Role Enums
*
* Roles in the App Chain
*
* #see RolePermissions
* #see PermissionManager
*
* #return none
*/

contract Role {
    enum Role {
        NULL,
        ADMIN,
        TRADINGENTITY,
        CERTIFIER,
        MAX
    }
}
