pragma solidvm 3.0;

/**
* Role Enums
*
* Roles in the Network Onboarding App
*
* #see RolePermissions
* #see NetworkOnboardingPermissionManager
*
* #return none
*/

contract Role {
    enum Role {
        NULL,
        NETWORK_ADMIN,
        ORG_ADMIN,
        ORG_USER,
        MAX
    }
}
