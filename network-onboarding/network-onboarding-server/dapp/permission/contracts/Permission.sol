// pragma solidvm 3.0; // TODO: do we need this? SolidityParser doesn't like seing it, when we do getEnumsCached() 

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
        CREATE_ORG_USER,
        CREATE_ANY_USER,
        UPDATE_ROLE_NETWORK,
        UPDATE_ROLE_ORG,
        UPDATE_USER
    }
}
