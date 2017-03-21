import "./enums/Roles.sol";
import "./data/User.sol";
import "./WellManager.sol";
import "./libs/Administered.sol";

contract IAdminUM {
  WellManager public wellManager;
}

contract UserManager is Roles, Administered {
  User[] data;
  mapping (bytes32 => uint) dataMap;
  address public testAddress;

  function UserManager() {
    data.length = 1;
  }

  modifier nameAvailable(bytes32 username) {
    if (dataMap[username] == 0) {
      _
    } else throw;
  }

  function add(bytes32 username, RoleEnum r, address addr, bytes32 p) returns (uint userId) {
    userId = data.length;
    dataMap[username] = userId;
    data.push(new User(username, r, addr, p));
  }

  function getRole(bytes32 username) constant returns (RoleEnum) {
    var (, role, , ) = data[dataMap[username]].get();
    return role;
  }

  function get(bytes32 username) constant returns (bytes32, RoleEnum, address, bytes32) {
    return data[dataMap[username]].get();
  }

  function getIndex(bytes32 username) constant returns (uint) {
    return dataMap[username];
  }

  function getByIndex(uint id) constant returns (bytes32, RoleEnum, address, bytes32) {
    return data[id].get();
  }

  function getAddress(uint id) constant returns (address) {
    return address(data[id]);
  }

  function assignWell(bytes32 username, string wellName) {
    // verify the well exists
    if (IAdminUM(getAdmin()).wellManager().getId(wellName) == 0) throw;
    data[dataMap[username]].assignWell(IAdminUM(getAdmin()).wellManager().getAddress(wellName));
  }

  function isAssignedToWell(bytes32 username, string wellName) constant returns (bool) {
    return data[dataMap[username]].isAssignedToWell(IAdminUM(getAdmin()).wellManager().getAddress(wellName));
  }
}
