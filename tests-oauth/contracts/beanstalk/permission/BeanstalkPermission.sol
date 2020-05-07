/**
* Beanstalk Permissions Enums
*
* Permissions for the roles in the main application
*
* #see BeanstalkRolePermissions
* #see BeanstalkPermissionManager
*
* #return none
*/

contract BeanstalkPermission {
  enum BeanstalkPermission {
    APPROVE_MEMBERSHIP,
    UPDATE_MEMBERSHIP,
    REJECT_MEMBERSHIP,
    CREATE_AGREEMENT,
    UPDATE_AGREEMENT,
    CREATE_EVENT,
    UPDATE_EVENT,
    CREATE_EXCEPTION,
    CREATE_PROGRAM,
    UPDATE_PROGRAM,
    CREATE_EVENT_DEF,
    UPDATE_EVENT_DEF,
    CREATE_EXCEPTION_DEF,
    UPDATE_EXCEPTION_DEF,
    ADD_CHAIN_MEMBER,
    REMOVE_CHAIN_MEMBER,
    PROCESS_MEMBERSHIP
  }
}
