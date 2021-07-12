import "./Organization.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";

/**
 * The OrganizationManager contract is responsible for the onboarding and removal of organizations 
 * from the network by a network admin. The contract will also maintain a list of all Organizations 
 * in the network, so that applications can retrieve a list of all active organizations in the
 * network.

 * At a high level, the two abstraction layers are:
 *   OrganizationMembershipManager: the layer that uses provides buisness logic for controlling
 * what organizations are made, deletion of organizations etc. Doesn't do permission verification.
 *   OrganizationManager: provides a simple API to control which organizations are in use. Does the
 * permission verification too since it directly modifies which orgs are in use.
 */

contract OrganizationManager is RestStatus {
    mapping(string => address) organizations;
    NetworkOnboardingPermissionManager public permissionManager;


    constructor(address _permissionManager) {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
    }

    /**
     * Returns the mapping of organization common names to Organization contract addresses
     */
    function getOrganizations() returns (mapping(string=>address)) {
        return organizations;
    }

    /**
     * Creates an Organization contract for an organization given its common name and certificate
     * string, creates a new X509 contract for it’s certificate.
     * Adds the newly created Organization contract address to the organization list
     */
    function createOrganization(string _commonName, string _certificateString) returns (uint, address) {
        if (!permissionManager.canCreateOrganization(tx.origin))
            return (RestStatus.FORBIDDEN, tx.origin);

        mapping(string=>string) certificate = parseCert(_certificateString);
        Organization org = new Organization(_commonName, certificate["certString"]);
        organizations[_commonName] = org;
        return (RestStatus.CREATED, org);
    }

    function removeOrganization(string _commonName) returns (uint) {
        if (!permissionManager.canRemoveOrganization(tx.origin))
            return RestStatus.FORBIDDEN;

        org = organizations[_commonName];
        if(org != address(0)) {
            delete organizations[_commonName];
            org.revoke();
            return RestStatus.OK;
        } else {
            return RestStatus.BAD_REQUEST;
        }

        
    }

    function updateOrganizationCertificate(string _commonName, string _newCertificate) {
        // TODO
    }
}