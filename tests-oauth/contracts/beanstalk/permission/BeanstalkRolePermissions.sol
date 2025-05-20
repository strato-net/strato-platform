import "./BeanstalkPermission.sol";
import "./BeanstalkRole.sol";

/**
* Beanstalk Role Permissions
*
* Mapping of the roles to their respective permissions
*
* #see BeanstalkPermissionManager
* #see BeanstalkRole
* #see BeanstalkPermission
*
* #return none
*/

contract record BeanstalkRolePermissions is BeanstalkRole, BeanstalkPermission {
  uint[] rolePermissions;

  /**
  * Constructor
  */
  constructor() public {
    rolePermissions.length = uint(BeanstalkRole.MAX);
    rolePermissions[uint(BeanstalkRole.NULL)] = 0;

    for (uint i = 0; i < uint(BeanstalkRole.MAX); i++) {
      rolePermissions[i] = 0xffffffff;
    }
    // Assigning permissions to Beanstalk roles
    //    rolePermissions[uint(BeanstalkRole.BOOT_NODE_SERVICE_ACCOUNT)] =
    //      (1 << uint(BeanstalkPermission.UPDATE_MEMBERSHIP)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EVENT_DEF)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EXCEPTION_DEF)) |
    //      (1 << uint(BeanstalkPermission.CREATE_PROGRAM)) |
    //      (1 << uint(BeanstalkPermission.APPROVE_MEMBERSHIP)) |
    //      (1 << uint(BeanstalkPermission.REJECT_MEMBERSHIP)) |
    //      (1 << uint(BeanstalkPermission.ADD_CHAIN_MEMBER)) |
    //      (1 << uint(BeanstalkPermission.REMOVE_CHAIN_MEMBER));
    //
    //    rolePermissions[uint(BeanstalkRole.MEMBERSHIP_MANAGER)] =
    //      (1 << uint(BeanstalkPermission.UPDATE_MEMBERSHIP));
    //
    //    rolePermissions[uint(BeanstalkRole.AGREEMENT_MANAGER)] =
    //      (1 << uint(BeanstalkPermission.CREATE_AGREEMENT)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_AGREEMENT));
    //
    //    rolePermissions[uint(BeanstalkRole.PROGRAM_MANAGER)] =
    //      (1 << uint(BeanstalkPermission.CREATE_PROGRAM)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EVENT_DEF)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EVENT_DEF)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EXCEPTION_DEF)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EXCEPTION_DEF));
    //
    //    rolePermissions[uint(BeanstalkRole.TECH_PROVIDER)] =
    //      (1 << uint(BeanstalkPermission.APPROVE_MEMBERSHIP)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_MEMBERSHIP)) |
    //      (1 << uint(BeanstalkPermission.REJECT_MEMBERSHIP)) |
    //      (1 << uint(BeanstalkPermission.CREATE_AGREEMENT)) |
    //      (1 << uint(BeanstalkPermission.CREATE_PROGRAM)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EVENT_DEF)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EVENT_DEF)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EXCEPTION_DEF)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EXCEPTION_DEF)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EVENT)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EVENT)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EXCEPTION)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_PROGRAM)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_AGREEMENT)) |
    //      (1 << uint(BeanstalkPermission.ADD_CHAIN_MEMBER)) |
    //      (1 << uint(BeanstalkPermission.REMOVE_CHAIN_MEMBER));
    //
    //    rolePermissions[uint(BeanstalkRole.COMPLIANCE_MANAGER)] =
    //      (1 << uint(BeanstalkPermission.CREATE_EXCEPTION_DEF)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EXCEPTION_DEF)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EVENT)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_EVENT)) |
    //      (1 << uint(BeanstalkPermission.CREATE_EXCEPTION)) |
    //      (1 << uint(BeanstalkPermission.UPDATE_AGREEMENT)) |
    //      (1 << uint(BeanstalkPermission.ADD_CHAIN_MEMBER)) |
    //      (1 << uint(BeanstalkPermission.REMOVE_CHAIN_MEMBER));
    //
    //    rolePermissions[uint(BeanstalkRole.INTEGRATION_SERVER)] =
    //      (1 << uint(BeanstalkPermission.CREATE_AGREEMENT));
    //
    //    rolePermissions[uint(BeanstalkRole.ADMIN)] =
    //    (1 << uint(BeanstalkPermission.APPROVE_MEMBERSHIP)) |
    //    (1 << uint(BeanstalkPermission.UPDATE_MEMBERSHIP)) |
    //    (1 << uint(BeanstalkPermission.REJECT_MEMBERSHIP)) |
    //    (1 << uint(BeanstalkPermission.CREATE_AGREEMENT)) |
    //    (1 << uint(BeanstalkPermission.UPDATE_AGREEMENT)) |
    //    (1 << uint(BeanstalkPermission.CREATE_EVENT)) |
    //    (1 << uint(BeanstalkPermission.UPDATE_EVENT)) |
    //    (1 << uint(BeanstalkPermission.CREATE_EXCEPTION)) |
    //    (1 << uint(BeanstalkPermission.CREATE_PROGRAM)) |
    //    (1 << uint(BeanstalkPermission.UPDATE_PROGRAM)) |
    //    (1 << uint(BeanstalkPermission.CREATE_EVENT_DEF)) |
    //    (1 << uint(BeanstalkPermission.UPDATE_EVENT_DEF)) |
    //    (1 << uint(BeanstalkPermission.CREATE_EXCEPTION_DEF)) |
    //    (1 << uint(BeanstalkPermission.UPDATE_EXCEPTION_DEF)) |
    //    (1 << uint(BeanstalkPermission.ADD_CHAIN_MEMBER)) |
    //    (1 << uint(BeanstalkPermission.REMOVE_CHAIN_MEMBER));
  }

  function getRolePermissions(BeanstalkRole _role) public view returns (uint) {
    // Get Permissions
    return rolePermissions[uint(_role)];
  }
}
