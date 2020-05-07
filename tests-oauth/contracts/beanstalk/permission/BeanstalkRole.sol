/**
* Beanstalk Role Enums
*
* Roles in the main application
*
* #see BeanstalkRolePermissions
* #see BeanstalkPermissionManager
*
* #return none
*/

contract BeanstalkRole {
  enum BeanstalkRole {
    NULL,
    BOOT_NODE_SERVICE_ACCOUNT,
    NETWORK_NODE_SERVICE_ACCOUNT,
    NODE_MANAGER,
    MEMBERSHIP_MANAGER,
    AGREEMENT_MANAGER,
    PROGRAM_MANAGER,
    TECH_PROVIDER,
    COMPLIANCE_MANAGER,
    GROWER,
    DEALER,
    PROCESSOR,
    INTEGRATION_SERVER,
    ADMIN,
    DEALER_SERVICE,
    GROWER_SERVICE,
    PROCESSOR_SERVICE,
    MAX
  }
}
