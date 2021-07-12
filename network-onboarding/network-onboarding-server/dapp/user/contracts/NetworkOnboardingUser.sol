import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permission/contracts/Role.sol";

/**
 * NetworkOnboardingUser container
 *
 * This container holds the data for one user. The Users list is managed by the UserManager
 *
 * #see NetworkOnboardingUserManager
 *
 * #param {address} blockchainAddress : user blockchain address
 * #param {string} enodeAddress : enode address of an user in the blockchain
 * #param {address} organization : user organization
 *
 * #return none
 */

contract NetworkOnboardingUser is RestStatus, Role {
  address public owner;
  string public enodeAddress;
  string public username;
  Role public role;
  
  address public organization;
  address public blockchainAddress;

  constructor(string _username, string _enodeAddress, Role _role) {
    owner = msg.sender;
    enodeAddress = _enodeAddress;
    username = _username;
    role = _role;
  }

  function setUserOrganization(address _organization) returns (uint) {
    if (msg.sender != owner) { return RestStatus.FORBIDDEN; }
    organization = _organization;
    return RestStatus.OK;
  }
  
  function setUserBlockchainAddress(address _blockchainAddress) returns (uint) {
    if (msg.sender != owner) { return RestStatus.FORBIDDEN; }
    blockchainAddress = _blockchainAddress;
    return RestStatus.OK;
  }
}
