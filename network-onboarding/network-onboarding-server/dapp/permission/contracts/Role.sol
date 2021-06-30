/**
* Role Enums
*
* Roles in the Carbon main chain
*
* #see RolePermissions
* #see PermissionManager
*
* #return none
*/

// NOTE: this is the same as the regular OrgRole enum. We need them the same so the UI
//   can distinguish all 3 roles. Otherwise we have two roles that share number 1, number 2, etc.
//   Eventually, one of them should be removed and all contracts point to the other
contract Role {
    enum Role {
        NULL,
        GLOBAL_ADMIN,
        ORG_ADMIN,
        ORG_USER,
        MAX
    }
}
