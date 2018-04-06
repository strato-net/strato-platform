import "./enums/Permissions.sol";
import "./enums/Roles.sol";
import "./libs/Administered.sol";
import "./UserManager.sol";

contract IAdminPM {
  UserManager public userManager;
}

contract PermissionManager is Permissions, Roles, Administered {
  mapping (uint => PermissionEnum[]) data;
  mapping (bytes32 => uint) dataMap;


  function PermissionManager() {
    add(RoleEnum.RIG, PermissionEnum.VIEW_RIG_DASHBOARD);
    add(RoleEnum.RIG, PermissionEnum.ACQUIRE_SAMPLE);

    add(RoleEnum.OFFICE, PermissionEnum.VIEW_OFFICE_DASHBOARD);
    add(RoleEnum.OFFICE, PermissionEnum.PLAN_SAMPLE);
  }


  function add(RoleEnum re, PermissionEnum pe) internal {
    uint roleId = uint(re);

    uint mappingId = data[roleId].length;
    bytes32 hash = sha3(roleId, uint(pe));

    if (data[roleId].length == 0)
      data[roleId].length = 1;

    // If role-permission already recorded, throw
    if (dataMap[hash] > 0) throw;

    dataMap[hash] = mappingId;
    data[roleId].push(pe);
  }

  function hasPermission(RoleEnum re, PermissionEnum pe) constant returns (bool) {
    return dataMap[sha3(uint(re), uint(pe))] > 0;
  }

  function get(bytes32 username) constant returns (PermissionEnum[]) {
    uint roleId = uint(IAdminPM(getAdmin()).userManager().getRole(username));
    uint length = data[roleId].length - 1;
    PermissionEnum[] memory results = new PermissionEnum[](length);
    for (uint i = 0; i < length; i++) {
      results[i] = data[roleId][i + 1];
    }
    return results;
  }
}
