import "./UserManager.sol";
import "./libs/Administered.sol";
import "./enums/Roles.sol";

contract IAdminBF {
  UserManager public userManager;
}

contract BusinessFunctions is Roles, Administered {
  function hasRole(bytes32 username, RoleEnum r) constant returns (bool) {
    return IAdminBF(getAdmin()).userManager().getRole(username) == r;
  }

  function wellAssigned(bytes32 username, string wellName) constant returns (bool) {
    return IAdminBF(getAdmin()).userManager().isAssignedToWell(username, wellName);
  }

  function CanViewSample(bytes32 username, string wellName) constant returns (bool) {
    return wellAssigned(username, wellName);
  }

  function ViewSample(bytes32 username, string wellName) {
    if (!CanViewSample(username, wellName)) throw;
  }

  function CanPlanSample(bytes32 username, string wellName) constant returns (bool) {
    return hasRole(username, RoleEnum.OFFICE) && wellAssigned(username, wellName);
  }

  function PlanSample(bytes32 username, string wellName) {
    if (!CanPlanSample(username, wellName)) throw;
  }
}
