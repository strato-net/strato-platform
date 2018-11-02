import "./EchoRole.sol";
import "./EchoPermission.sol";

contract EchoRolePermissions  is EchoRole, EchoPermission {
  uint[] rolePermissions;
  constructor() {
    rolePermissions.length = uint(EchoRole.OFFICER)+1;
    rolePermissions[uint(EchoRole.NULL)] = 0;

    rolePermissions[uint(EchoRole.ADMIN)] =
      (1 << uint(EchoPermission.MANAGE_MANAGERS)) |
      (1 << uint(EchoPermission.TRANSFER_OWNERSHIP_MAP)) |
      (1 << uint(EchoPermission.GAS_MODIFY_DEAL)) |
      (1 << uint(EchoPermission.GAS_CREATE_DEAL)) |
      (1 << uint(EchoPermission.GAS_CAN_ADD_PRICE_INDEX)) |
      (1 << uint(EchoPermission.POWER_MODIFY_DEAL)) |
      (1 << uint(EchoPermission.POWER_CREATE_DEAL)) ;

    rolePermissions[uint(EchoRole.GAS_DEAL_MANAGER)] =
      (1 << uint(EchoPermission.TRANSFER_OWNERSHIP_MAP)) |
      (1 << uint(EchoPermission.GAS_MODIFY_DEAL)) |
      (1 << uint(EchoPermission.GAS_CREATE_DEAL)) |
      (1 << uint(EchoPermission.GAS_CAN_ADD_PRICE_INDEX)) ;

    rolePermissions[uint(EchoRole.POWER_DEAL_MANAGER)] =
      (1 << uint(EchoPermission.TRANSFER_OWNERSHIP_MAP)) |
      (1 << uint(EchoPermission.POWER_MODIFY_DEAL)) |
      (1 << uint(EchoPermission.POWER_CREATE_DEAL)) ;

    rolePermissions[uint(EchoRole.MANAGERS_MANAGER)] =
      (1 << uint(EchoPermission.TRANSFER_OWNERSHIP_MAP)) ;

    rolePermissions[uint(EchoRole.TRADER)] = 0;
    rolePermissions[uint(EchoRole.OFFICER)] = 0;
  }

  function getRolePermissions(EchoRole _role) returns (uint) {
    return rolePermissions[uint(_role)];
  }
}
