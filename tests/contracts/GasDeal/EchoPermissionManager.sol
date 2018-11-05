import "./PermissionManager.sol";
import "./EchoPermission.sol";
import "./EchoRolePermissions.sol";

/**
* Echo Permission Manager
*/
contract EchoPermissionManager is PermissionManager, EchoPermission, EchoRolePermissions {

  constructor(
    address _admin,
    address _master) public
    PermissionManager(_admin, _master) {
    // grant Echo Admin permissions to admin
    grantRole('Admin', _admin, EchoRole.ADMIN);
  }

  function grantRole(string _id, address _address, EchoRole _role) public returns (uint, uint) {
    uint permissions = getRolePermissions(_role);
    return grant(_id, _address, permissions);
  }

  function canCreateGasDeal(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.GAS_CREATE_DEAL);
    return check(_address, permissions) == RestStatus.OK;
  }

  function canModifyGasDeal(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.GAS_MODIFY_DEAL);
    return check(_address, permissions) == RestStatus.OK;
  }

  function canAddGasPriceIndex(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.GAS_CAN_ADD_PRICE_INDEX);
    return check(_address, permissions) == RestStatus.OK;
  }

  function canCreatePowerDeal(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.POWER_CREATE_DEAL);
    return check(_address, permissions) == RestStatus.OK;
  }

  function canModifyPowerDeal(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.POWER_MODIFY_DEAL);
    return check(_address, permissions) == RestStatus.OK;
  }

  function canTransferOwnershipMap(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.TRANSFER_OWNERSHIP_MAP);
    return check(_address, permissions) == RestStatus.OK;
  }

  function canManageManagers(address _address) returns (bool) {
    uint permissions = 1 << uint(EchoPermission.MANAGE_MANAGERS);
    return check(_address, permissions) == RestStatus.OK;
  }
}
