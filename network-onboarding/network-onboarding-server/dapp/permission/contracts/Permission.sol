/**
* Carbon Permissions Enums
*
* Permissions for the roles in the Carbon main chain
*
* #see RolePermissions
* #see PermissionManager
*
* #return none
*/

contract Permission {
    enum Permission {
        CREATE_ORG,
        UPDATE_ORG,
        UPDATE_ORG_LIMITED,
        CREATE_RU,
        UPDATE_RU,
        CREATE_USER,
        CREATE_USER_LIMITED,
        UPDATE_USER,
        UPDATE_USER_LIMITED,
        MODIFY_MEMBERSHIP
    }
}
