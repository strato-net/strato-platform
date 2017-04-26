import "./libs/Administered.sol";
import "./enums/Roles.sol";

/**
  * UserManager Interface for WellManager, exposing the required methods
*/
contract IUserManager is Roles {
  function get(bytes32) constant returns (bytes32, RoleEnum, address, bytes32);
  function getWellCount(bytes32) constant returns (uint);
  function getWell(bytes32, uint) constant returns (uint);
}

/**
  * Interface for the well data
*/
contract WellManager is Administered {
  struct Well {
    string name;
    string wellHeadBUID;
    string boreHoleBUID;
  }
  Well[] data;
  mapping (string => uint) dataMap;

  /**
    * Constructor
  */
  function WellManager() {
    data.length = 1;
  }

  /**
    * Add a new well
    * @param name {string} - name of the well (must be unique)
    * @param wellHeadBUID {string} - ID of the well
    * @param boreHoleBUID {string} - borHole ID for the well
  */
  function add(string name, string wellHeadBUID, string boreHoleBUID) returns (bool) {
    if (uint(dataMap[name]) > 0) throw;
    dataMap[name] = data.length;
    data.push(Well(name, wellHeadBUID, boreHoleBUID));
    return true;
  }

  /**
    * Return the data index for a wellname
    * @param name {string} - name of the well to lookup
    * @return {uint} - index of the well information this.data
  */
  function getId(string name) constant returns (uint) {
    return dataMap[name];
  }

  /**
    * Return the names of a well witha given ID
    * @param id {uint} - id of well
    * @return {string} - name of well
  */
  function getWellName(uint id) constant returns (bytes) {
    return bytes(data[id].name);
  }

  /**
    * Return the length of the well name with id
    * @param id {uint} - id of well
    * @return {uint} - length in bytes of the well name
  */
  function getWellNameLength(uint id) constant returns (uint) {
    return bytes(data[id].name).length;
  }

  /**
    * Return a single byte of the well name at a given index
    * @param id {uint} - id of well
    * @param index {uint} - index of the character in the wellname
    * @return {bytes1} - character at the specified index of the wellName
  */
  function getWellNameChar(uint id, uint index) constant returns (bytes1) {
    return bytes(data[id].name)[index];
  }
}
