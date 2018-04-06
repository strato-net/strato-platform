/**
 * Inheritable methods helpful for keeping track of an Admin (that is designated post-contract-initialization)
*/
contract Administered {
  address _admin;        // address of administrator

  /**
    * Return administrator of this contract if any
    * @return {address} - address of administrator
  */
  function getAdmin() constant returns(address) {
    return _admin;
  }

  /**
    * Set a new administrator
    * @param newAdmin {address} - address of new administrator
  */
  function setAdmin(address newAdmin) {
    if (uint(_admin) == 0 || _admin == msg.sender)
      _admin = newAdmin;
  }
}
