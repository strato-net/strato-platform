pragma solidvm 3.0;

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";

/**
 * Single entry point to all the project's contract
 * Deployed by the deploy script
 */
 
contract NetworkOnboardingDapp {
 
  address owner; 
  NetworkOnboardngPermissionManager public permissionManager;

  constructor() {
    owner = msg.sender;
    permissionManager = new NetworkOnboardingPermissionManager(msg.sender, msg.sender);
     
    // TODO: add the rest of the manager initializations
  }
}
