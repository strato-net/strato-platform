import "../PermissionManager.sol";
import "../RestStatus.sol";
import "../user/BeanstalkUserManager.sol";
import "./BeanstalkPermission.sol";
import "./BeanstalkRolePermissions.sol";
import "./BeanstalkRole.sol";

/**
* Beanstalk Permissions Manager
*
* Entry point to grant and revoke role for a user. Also check whether a
* user has permission to perform a particular actions or not.
*
* #see BeanstalkRolePermission
* #see BeanstalkRole
* #see BeanstalkPermission
*
* #return none
*/

contract BeanstalkPermissionManager is RestStatus, PermissionManager, BeanstalkPermission, BeanstalkRolePermissions {
  BeanstalkUserManager userManager;
  /**
  * Constructor
  */
  constructor(address _admin, address _master)
    public
    PermissionManager(_admin, _master) {
  }

  function setBeanstalkUserManager(address _beanstalkUserManager) {
    userManager = BeanstalkUserManager(_beanstalkUserManager);
  }

  function grantRole(string _id, address _address, BeanstalkRole _role) public returns (uint, uint) {
    // Get permission for a role
    uint permissions = getRolePermissions(_role);
    // Get current user permissions
    var (restStatus, userPermissions) = getPermissions(_address);
    if (restStatus == RestStatus.OK) {
      if (userPermissions > 0) {
        permissions &= userPermissions ^ 0xFFFFFFFF;
      }
    }
    // Grant role to a user
    if (permissions == 0) {
      return (RestStatus.OK, userPermissions);
    }
    return grant(_id, _address, permissions);
  }

  function canProcessMembership(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.PROCESS_MEMBERSHIP);
    // Check permission
    //return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canRejectMembership(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.REJECT_MEMBERSHIP);
    // Check permission
    //return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canApproveMembership(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.APPROVE_MEMBERSHIP);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canUpdateMembership(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.UPDATE_MEMBERSHIP);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canCreateAgreement(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.CREATE_AGREEMENT);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canUpdateAgreement(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.UPDATE_AGREEMENT);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canCreateEvent(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.CREATE_EVENT);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canUpdateEvent(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.UPDATE_EVENT);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canCreateException(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.CREATE_EXCEPTION);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canCreateProgram(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.CREATE_PROGRAM);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canUpdateProgram(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.UPDATE_PROGRAM);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canCreateEventDef(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.CREATE_EVENT_DEF);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canCreateExceptionDef(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.CREATE_EXCEPTION_DEF);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canUpdateExceptionDef(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.UPDATE_EXCEPTION_DEF);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canAddChainMember(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.ADD_CHAIN_MEMBER);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }

  function canRemoveChainMember(address _address) public returns (bool) {
    // Get beanstalk user if user manager is defined
    address user = _address;
    if (address(userManager) != address(0)) {
      (uint restStatus, address _user) = userManager.getByAddress(_address);
      if (restStatus == RestStatus.OK) {
        user = _user;
      }
    }
    // Get permission
    uint permissions = 1 << uint(BeanstalkPermission.REMOVE_CHAIN_MEMBER);
    // Check permission
    // return check(_address, permissions) == RestStatus.OK;
    return true;
  }
}
