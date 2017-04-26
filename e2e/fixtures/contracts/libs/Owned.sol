/**
 * Inheritable contract that enables the ownership pattern
 */
contract Owned {
  address _owner;        // address pointing to the owner of this contract

  function Owned() {
    _owner = msg.sender;
  }

  /**
   * Get the owner of the current contract
   * @return {address} owner's address
   */
  function getOwner() constant returns (address) {
    return _owner;
  }

  /**
   * Change the owner of the contact (must be the current owner)
   * @param newOwner {address} - address of the new owner
   */
  function chown(address newOwner) isOwned {
    _owner = newOwner;
  }

  /**
   * (modifier) check if the msg.sender is current owner
   */
  modifier isOwned() {
    if (_owner == msg.sender) _
      else throw;
  }
}
