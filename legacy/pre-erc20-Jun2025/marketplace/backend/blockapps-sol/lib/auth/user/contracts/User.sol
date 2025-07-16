
/**
 * User data contract
 */
contract User {
  address public account;
  string public username;

  // internal
  uint public updateCounter = 0;

  function User(address _account, string _username) {
    account = _account;
    username = _username;
    updateCounter = 1; // set update counter
  }

}
