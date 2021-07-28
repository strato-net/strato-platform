pragma solidvm 3.0;

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";

import "/dapp/application/contracts/ApplicationManager.sol";


/**
 * Single entry point to all the project's contract
 * Deployed by the deploy script
 */
 
contract NetworkOnboardingDapp {
 
  address owner; 
  NetworkOnboardingPermissionManager public permissionManager;
  ApplicationManager public applicationManager;

  constructor() {
    owner = msg.sender;
    permissionManager = new NetworkOnboardingPermissionManager(msg.sender, msg.sender);
    applicationManager = new ApplicationManager(permissionManager, /* TODO */ address(0)); 

    // TODO: add the rest of the manager initializations
  }
}
