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

        // Organization organization = organizationManager.get(tx.organization);
        // if (organization == address(0)) {
        //     return (RestStatus.NOT_FOUND, tx.origin);
        // }


        // create new Application
        Application application = new Application(_name, organization);

        // created
        return (RestStatus.CREATED, application);
    }

    function addOrganizationToApplication(
          address _app,
          address _org
    ) public returns (uint256, address) {
        
        // ensure caller is an org admin
        if (!permissionManager.canInviteToJoinApplication(tx.origin)) {
            return (RestStatus.FORBIDDEN, tx.origin);
        }

        // ensure that the org we want to add exists
        Organization newOrg = Organization(_org);
        if (address(newOrg) == 0) return (RestStatus.NOT_FOUND, _org);

        // get the app
        Application app = Application(_app);
        if (address(app) == 0) return (RestStatus.NOT_FOUND, _app);

        // get the owner org
        Organization ownerOrg = Organization(app.ownerOrganization);
        if (address(ownerOrg) == 0) return (RestStatus.NOT_FOUND, address(0));


        // check that this caller is actually part of this org
        if (tx.organization != ownerOrg.commonName) {
          return (RestStatus.FORBIDDEN, tx.origin);
        }

        // add the org to the app
        app.organizations[newOrg.commonName] = address(newOrg);
        return (RestStatus.OK, address(app));
    }
}
