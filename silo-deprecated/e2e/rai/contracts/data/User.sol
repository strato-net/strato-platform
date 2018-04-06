import "../enums/Roles.sol";
import "../libs/Owned.sol";

/**
  * User data contract
*/
contract User is Roles, Owned {
  RoleEnum role;
  bytes32 username;
  address owner;
  bytes32 pwHash;
  uint[] assignedWells;
  string orgName;

  mapping (uint => uint) wellMap;

  /**
    * Constructor
    * @param _username {bytes32} - username
    * @param _role {RoleEnum} - role to assign to user
    * @param _owner {address} - address of the user contract
    * @param _pwHash {bytes32} - hash of user password
    * @param _orgName {string} - name of user's organization
  */
  function User(bytes32 _username, RoleEnum _role, address _owner, bytes32 _pwHash, string _orgName) {
    username = _username;
    role = _role;
    owner = _owner;
    pwHash = _pwHash;
    orgName = _orgName;

    assignedWells.length = 1;
  }

  /**
    * Edit a user account (must be called by owner)
    * @param _username {bytes32} - username
    * @param _role {RoleEnum} - role to assign to user
    * @param _owner {address} - address of the user contract
    * @param _pwHash {bytes32} - hash of user password
    * @param _orgName {string} - name of user's organization
  */
  function edit(bytes32 _username, RoleEnum _role, address _owner, bytes32 _pwHash, string _orgName) isOwner {
    username = _username;
    role = _role;
    owner = _owner;
    pwHash = _pwHash;
    orgName = _orgName;
  }

  /**
    * Assign a well to a user
    * @param wellId {uint} - id of well
  */
  function assignWell(uint wellId) isOwner returns (bool) {
    // well already assigned
    if (wellMap[wellId] > 0) throw;

    wellMap[wellId] = assignedWells.length;
    assignedWells.push(wellId);
    return true;
  }

  /**
    * Check if a user is assigned to a well
    * @param wellId {uint} - id of well
    * @return {bool} - whether or not user assigned to wellId
  */
  function isAssignedToWell(uint wellId) constant returns (bool) {
    return wellMap[wellId] > 0;
  }

  /**
    * Return the well id assigned at requested index
    * @param index {uint} - index of the assigned well
    * @return {uint} - well id at the assigned index
  */
  function getWell(uint index) constant returns (uint) {
    return assignedWells[index];
  }

  /**
    * Return the number of wells assigned to this user
    * @return {uint} - number of wells assigned to user
  */
  function wellCount() constant returns (uint) {
    return assignedWells.length;
  }

  /**
    * Return the name of the user's organization
    * @return {string} - org name
  */
  function getOrgName() constant returns (string) {
    return orgName;
  }

  /**
    * Return the attributes associated with this User
    * @return {bytes32, RoleEnum, address, bytes32}
  */
  function get() constant returns (bytes32, RoleEnum, address, bytes32) {
    return (username, role, owner, pwHash);
  }
  
  /**
    * Get the length of the user's organization name
    * @return {uint} - length of org name
  */
  function getOrgNameLength() constant returns (uint) {
    return bytes(orgName).length;
  }

  /**
    * Get a specific character of the user's organization name
    * @param index {uint} - index of the character in the orgName string
    * @return {bytes1} - character of the orgName
  */
  function getOrgNameChar(uint index) constant returns (bytes1) {
    return bytes(orgName)[index];
  }

}
