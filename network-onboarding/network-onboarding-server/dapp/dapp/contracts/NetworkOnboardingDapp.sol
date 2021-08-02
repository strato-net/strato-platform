// pragma solidvm 3.0;

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
import "/dapp/users/contracts/NetworkOnboardingUsersManager.sol";
import "/dapp/organizations/contracts/OrganizationsManager.sol";
import "/dapp/organizations/membership/contracts/OrganizationMembershipsManager.sol";

import "/dapp/applications/contracts/ApplicationsManager.sol";


/**
 * Single entry point to all the project's contract
 * Deployed by the deploy script
 */
 
contract NetworkOnboardingDapp {
 
  address owner; 
  NetworkOnboardingPermissionManager public permissionManager;
  NetworkOnboardingUsersManager public userManager;
  OrganizationsManager public organizationsManager;
  OrganizationMembershipsManager public organizationMembershipsManager;
  ApplicationsManager public applicationsManager;

  constructor() {
    owner = msg.sender;
    permissionManager = new NetworkOnboardingPermissionManager(msg.sender, msg.sender);
    userManager = new NetworkOnboardingUsersManager(permissionManager);
    organizationsManager = new OrganizationsManager(permissionManager, userManager);
    organizationMembershipsManager = new OrganizationMembershipsManager(permissionManager, organizationsManager); // userManager?
    applicationsManager = new ApplicationsManager(permissionManager, organizationsManager);
  }
}
