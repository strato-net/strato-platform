pragma solidvm 3.0;

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
        // ORGS
        INVITE_ORG,
        CREATE_ORG,
        REMOVE_ORG,
//        UPDATE_ORG,
        
        // APPS
        REQUEST_JOIN_APP,
        INVITE_JOIN_APP,
        CREATE_APP,
//        UPDATE_APP,
        
        // USERS
        INVITE_JOIN_ORG,
        CREATE_USER,
        UPDATE_ROLE_NETWORK,
        UPDATE_ROLE_ORG
//        UPDATE_USER,
    }
}
