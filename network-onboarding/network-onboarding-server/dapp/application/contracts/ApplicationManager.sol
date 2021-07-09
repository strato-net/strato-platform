import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
// import "/blockapps-sol/lib/util/contracts/Util.sol";

import "./Application.sol";

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
// import "/dapp/organizations/contracts/OrganizationManager.sol";

/**
 * Application Manager
 *
 * Entry point to create new application
 *
 * #see Application
 *
 * #return none
 */

contract ApplicationManager is RestStatus {
    NetworkOnboardingPermissionManager permissionManager;
//    OrganizationManager organizationManager;
    address organization;

    /**
     * Constructor
     */
    constructor(address _permissionManager, address _organizationManager) public {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
        //organizationManager = OrganizationManager(_organizationManager);
        organization = _organizationManager;
    }

    function createApplication(
        string _name
    ) public returns (uint256, address) {
        // check permissions
        if (!permissionManager.canCreateApplication(tx.origin)) {
            return (RestStatus.FORBIDDEN, tx.origin);
        }

        // check user's org from cert, find corresponding Org contract

        // Organization organization = organizationManager.get(tx.username);
        // if (organization == address(0)) {
        //     return (RestStatus.NOT_FOUND, tx.origin);
        // }


        // create new Application
        Application application = new Application(_name, organization);

        // created
        return (RestStatus.CREATED, application);
    }
}
