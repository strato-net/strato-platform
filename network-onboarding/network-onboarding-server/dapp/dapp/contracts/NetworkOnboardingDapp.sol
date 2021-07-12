pragma solidvm 3.0;

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
import "/dapp/user/contracts/NetworkOnboardingUserManager.sol";
import "/dapp/organization/contracts/OrganizationManager.sol";
import "/dapp/organization/membership/contracts/OrganizationMembershipManager.sol";

/**
 * Single entry point to all the project's contract
 * Deployed by the deploy script
 */
 
contract NetworkOnboardingDapp {
 
  address owner; 
  NetworkOnboardingPermissionManager public permissionManager;
  NetworkOnboardingUserManager public userManager;
  OrganizationManager public organizationManager;
  OrganizationMembershipManager public organizationMembershipManager;

  constructor() {
    owner = msg.sender;
    permissionManager = new NetworkOnboardingPermissionManager(msg.sender, msg.sender);
    userManager = new NetworkOnboardingUserManager(permissionManager);
    organizationManager = new OrganizationManager(permissionManager); // userManager?
    organizationMembershipManager = new OrganizationMembershipManager(permissionManager, organizationManager);
     
    // TODO: add the rest of the manager initializations
  }
}
