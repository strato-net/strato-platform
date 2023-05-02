/**
* App Permissions Enums
*
* Permissions for the roles in the app chain
*
* #see RolePermissions
* #see PermissionManager
*
* #return none
*/

contract Permission {
    enum Permission {
        NULL,
        CREATE_USERMEMBERSHIP,
        UPDATE_USERMEMBERSHIP,
        CREATE_CATEGORY,
        UPDATE_CATEGORY,
        CREATE_SUBCATEGORY,
        UPDATE_SUBCATEGORY,
        CREATE_PRODUCT,
        UPDATE_PRODUCT,
        DELETE_PRODUCT,
        CREATE_INVENTORY,
        UPDATE_INVENTORY,
        CREATE_ORDER,
        UPDATE_ORDER,
        CREATE_EVENT_TYPE,
        CREATE_EVENT,
        UPDATE_EVENT,
        CERTIFY_EVENT,
        MAX
    }
}
