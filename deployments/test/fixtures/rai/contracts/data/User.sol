import "../enums/Roles.sol";
import "../libs/Owned.sol";
import "./Well.sol";

contract User is Roles, Owned {
  RoleEnum role;
  bytes32 username;
  address owner;
  bytes32 pwHash;
  Well[] assignedWells;
  mapping (address => uint) wellMap;

  function User(bytes32 uname, RoleEnum r, address o, bytes32 pw) {
    role = r;
    username = uname;
    owner = o;
    pwHash = pw;

    assignedWells.length = 1;
  }

  function edit(bytes32 uname, RoleEnum r, address o, bytes32 pw) isOwner {
    uname = uname;
    role = r;
    owner = o;
    pwHash = pw;
  }

  function assignWell(address wellAddress) {
    // well already assigned
    if (wellMap[wellAddress] > 0) throw;

    wellMap[wellAddress] = assignedWells.length;
    assignedWells.push(Well(wellAddress));
  }

  function isAssignedToWell(address wellAddress) returns (bool) {
    return wellMap[wellAddress] > 0;
  }

  function get() constant returns (bytes32, RoleEnum, address, bytes32) {
    return (username, role, owner, pwHash);
  }
}
