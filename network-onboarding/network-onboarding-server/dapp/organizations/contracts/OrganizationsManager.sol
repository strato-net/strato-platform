import "./Organization.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
import "/dapp/users/contracts/NetworkOnboardingUsersManager.sol";

/**
 * The OrganizationsManager contract is responsible for the onboarding and removal of organizations 
 * from the network by a network admin. The contract will also maintain a list of all Organizations 
 * in the network, so that applications can retrieve a list of all active organizations in the
 * network.

 * At a high level, the two abstraction layers are:
 *   OrganizationMembershipsManager: the layer that uses provides buisness logic for controlling
 * what organizations are made, deletion of organizations etc. Doesn't do permission verification.
 *   OrganizationsManager: provides a simple API to control which organizations are in use. Does the
 * permission verification too since it directly modifies which orgs are in use.
 */

contract OrganizationsManager is RestStatus {
    mapping(string => address) organizations;   // orgName |-> Organization
    NetworkOnboardingPermissionManager public permissionManager;
    NetworkOnboardingUsersManager public userManager;


    constructor(address _permissionManager, address _userManager) {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
        userManager = NetworkOnboardingUsersManager(_userManager);
    }

    /**
     * Creates an Organization contract for an organization given its common name and certificate
     * string, creates a new X509 contract for it’s certificate.
     * Adds the newly created Organization contract address to the organization list
     */
    function createOrganization(string _certificateString) returns (uint, address) {
        if (!permissionManager.canCreateOrganization(tx.origin))
            return (RestStatus.FORBIDDEN, tx.origin);

        // Does this organization exist?
        if (organizations[parseCert(_certificateString)["commonName"]] == 0)
            return (RestStatus.CONFLICT, tx.origin);

        Organization org = new Organization();
        registerCert(address(org), _certificateString);
        organizations[parseCert(_certificateString)["commonName"]] = org;
        return (RestStatus.CREATED, org);
    }

    function updateOrganizationCertificate(address _organization, string _newCertificate) {
        // TODO
    }

    function removeOrganization(string _commonName) returns (uint) {
        if (!permissionManager.canRemoveOrganization(tx.origin))
            return RestStatus.FORBIDDEN;

        // TODO: Add check for if the user has the correct role

        org = organizations[_commonName];
        if(org != address(0)) {
            delete organizations[_commonName];
            // org.revoke();
            return RestStatus.OK;
        } else {
            return RestStatus.BAD_REQUEST;
        }
    }

    /**
     * Returns the mapping of organization common names to Organization contract addresses
     */
    function getOrganizations() returns (mapping(string=>address)) {
        return organizations;
    }

    function getOrganization(string _orgName) returns (uint256, address) {
        if (organizations[_orgName] == address(0))
            return (RestStatus.NOT_FOUND, address(0));
        
        return (RestStatus.OK, organizations[_orgName]);
    }
}