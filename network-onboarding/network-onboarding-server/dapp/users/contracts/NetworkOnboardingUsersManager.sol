import "/blockapps-sol/lib/collections/hashmap/contracts/Hashmap.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
import "/dapp/organizations/contracts/Organization.sol";
import "/dapp/permission/contracts/Role.sol";

/**
 * NetworkOnboardingUsersManager
 *
 * Entry point to create new user and access existing users
 *
 * #see NetworkOnboardingUser
 *
 * #return none
 */

contract NetworkOnboardingUsersManager is RestStatus, Role {
    NetworkOnboardingPermissionManager permissionManager;

    /**
     * Constructor
     */
    constructor(address _permissionManager) public {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
    }

    // Register a user with the solidvm builtin registerCert
    function registerUser(
        address _userAddress,
        string _userCertificate,
        Role _role
    ) public returns (uint256, address) {

        if (permissionManager.canCreateAnyUser(tx.origin)) {
            registerCert(_userAddress, _userCertificate);
            permissionManager.grantRole(parseCert(_userCertificate)["commonName"], _userAddress, _role);

        } else if (permissionManage.canCreateOrgUser(tx.origin)) {

            if (getUserCert(tx.origin)["organization"] == parseCert(_userCertificate)["organization"]) {
                registerCert(_userAddress, _userCertificate);
                permissionManager.grantRole(parseCert(_userCertificate)["commonName"], _userAddress, _role);
            } else {
                return (RestStatus.FORBIDDEN, address(0));
            }
            
        } else {
            return (RestStatus.FORBIDDEN, address(0));
        }

        return (RestStatus.CREATED, _userAddress);
    }

    function updateUserCertificate(
        address _userAddress,
        string _userCertificate,
        Role _role
    ) public returns (uint256, address) {
        // check permissions
        if (!permissionManager.canCreateUser(tx.origin)) {
            address adminUser = getUser(tx.origin);
            if (adminUser == address(0)) {
                return (RestStatus.FORBIDDEN, address(0));
            }
            if (!permissionManager.canCreateUserLimited(tx.origin)) {
                return (RestStatus.FORBIDDEN, address(0));
            }

            // org admins (which canCreateUserLimited), can only create other org admins
            if (_role != Role.ORG_ADMIN) {
                return (RestStatus.FORBIDDEN, address(0));
            }
        }

        // user already exists?
        address existingUser = getUserByCommonName(_commonName);
        if (existingUser == address(0)) {
            return (RestStatus.CONFLICT, address(existingUser));
        }

        // Make sure the orgs remain the same

        registerCert(_userAddress, _userCertificate);

    }

    function updateUserRole(
        address _userAddress,
        Role _role
    ) public returns (uint256, address) {
        // check permissions
        if (!permissionManager.canCreateUser(tx.origin)) {
            address adminUser = getUser(tx.origin);
            if (adminUser == address(0)) {
                return (RestStatus.FORBIDDEN, address(0));
            }
            if (!permissionManager.canCreateUserLimited(tx.origin)) {
                return (RestStatus.FORBIDDEN, address(0));
            }

            // org admins (which canCreateUserLimited), can only create other org admins
            if (_role != Role.ORG_ADMIN) {
                return (RestStatus.FORBIDDEN, address(0));
            }
        }

        // user already exists?
        address existingUser = getUserByCommonName(_commonName);
        if (existingUser == address(0)) {
            return (RestStatus.CONFLICT, address(existingUser));
        }

        // Make sure the orgs remain the same

    }

    // TODO Test for when it is not found and return RestStatus.NOT_FOUND
    // TODO Platform: Let SolidVM return larger data structures
    getUser(address _user, string _index) returns (uint256, string) {
        if (permissionManager.canReadAnyUser(tx.origin)) {
            return (RestStatus.OK, getUserCert(_user)[_index]);
        } else if (permissionManager.canReadOrgUser(tx.origin)) {
            if (getUserCert(_user)["organization"] == getUserCert(tx.origin)["organization"]) {
                return (RestStatus.OK, getUserCert(_user)[_index]);
        } else {
            return (RestStatus.FORBIDDEN, "");
        }
    }
}
