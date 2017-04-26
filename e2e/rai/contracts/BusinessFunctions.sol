import "./UserManager.sol";
import "./PermissionManager.sol";
import "./libs/Administered.sol";
import "./enums/Permissions.sol";
import "./enums/Roles.sol";

/**
  * Admin Interface for BusinessFunctions, exposing the userManager and permissionManager pointers
*/
contract IAdminBF {
  UserManager public userManager;
  PermissionManager public permissionManager;
}

contract BusinessFunctions is Permissions, Roles, Administered {
  /**
    * Return whether a username has a particular permission
    * @param username {bytes32} - name ID of user
    * @param permission {PermissionEnum} - Permission to check for
    * @return {bool} - whether or not the username has permission
  */
  function hasPermission(bytes32 username, PermissionEnum permission) constant returns (bool) {
    RoleEnum role = IAdminBF(getAdmin()).userManager().getRole(username);
    return IAdminBF(getAdmin()).permissionManager().hasPermission(role, permission);
  }

  /**
    * Return whether a username has a particular well assigned
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username is assigned to the well
  */
  function wellAssigned(bytes32 username, string wellName) constant returns (bool) {
    return IAdminBF(getAdmin()).userManager().isAssignedToWell(username, wellName);
  }

  /**
    * Wrapper to check a username 1) has permission and 2) a well assigned
    * @param username {bytes32} - name ID of user
    * @param permission {PermissionEnum} - permission to check
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username has permission and  is assigned to well
  */
  function hasPermissionAndWell(bytes32 username, PermissionEnum permission, string wellName) constant returns (bool) {
    return hasPermission(username, permission) && wellAssigned(username, wellName);
  }


  /**
    * Return whether a username can view rig dashboard for a given well
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username can view the rig dashboard
  */
  function CanViewRigDashboard(bytes32 username, string wellName) constant returns (bool) {
    return hasPermissionAndWell(username, PermissionEnum.VIEW_RIG_DASHBOARD, wellName);
  }

  /**
    * Business function to View Rig Dashboard
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
  */
  function ViewRigDashboard(bytes32 username, string wellName) constant returns (bool) {
    if (!CanViewRigDashboard(username, wellName)) throw;
    return true;
  }

  /**
    * Return whether a username can acquire samples for a given well
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username can acquire samples
  */
  function CanAcquireSample(bytes32 username, string wellName) constant returns (bool) {
    return hasPermissionAndWell(username, PermissionEnum.ACQUIRE_SAMPLE, wellName);
  }

  /**
    * Business function to Acquire Samples
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
  */
  function AcquireSample(bytes32 username, string wellName) constant returns (bool) {
    if (!CanAcquireSample(username, wellName)) throw;
    return true;
  }

  /**
    * Return whether a username can view office dashboard for a given well
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username can view the office dashboard
  */
  function CanViewOfficeDashboard(bytes32 username, string wellName) constant returns (bool) {
    return hasPermissionAndWell(username, PermissionEnum.VIEW_OFFICE_DASHBOARD, wellName);
  }

  /**
    * Business function to View Office Dashboard
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
  */
  function ViewOfficeDashboard(bytes32 username, string wellName) constant returns (bool) {
    if (!CanViewOfficeDashboard(username, wellName)) throw;
    return true;
  }

  /**
    * Return whether a username can login for a given well
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username can login
  */
  function CanLogin(bytes32 username, string wellName) constant returns (bool) {
    return hasPermissionAndWell(username, PermissionEnum.LOGIN, wellName);
  }

  /**
    * Business function to Login
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
  */
  function Login(bytes32 username, string wellName) constant returns (bool) {
    if (!CanLogin(username, wellName)) throw;
    return true;
  }

  /**
    * Return whether a username can view a sample in a given well
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username can view samples at the well
  */
  function CanViewSample(bytes32 username, string wellName) constant returns (bool) {
    return hasPermissionAndWell(username, PermissionEnum.VIEW_SAMPLE, wellName);
  }

  /**
    * Business function to View Sample
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
  */
  function ViewSample(bytes32 username, string wellName) returns (bool) {
    if (!CanViewSample(username, wellName)) throw;
    return true;
  }

  /**
    * Return whether a username can plan a sample in a given well
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
    * @return {bool} - whether or not the username can plan samples for a well
  */
  function CanPlanSample(bytes32 username, string wellName) constant returns (bool) {
    return hasPermissionAndWell(username, PermissionEnum.PLAN_SAMPLE, wellName);
  }

  /**
    * Business function to Plan Sample
    * @param username {bytes32} - name ID of user
    * @param wellName {string} - well name to check for
  */
  function PlanSample(bytes32 username, string wellName) returns (bool) {
    if (!CanPlanSample(username, wellName)) throw;
    return true;
  }
}
