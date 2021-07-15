import "/blockapps-sol/lib/collections/hashmap/contracts/Hashmap.sol";
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";

import "./NetworkOnboardingUser.sol";

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
import "/dapp/organization/contracts/Organization.sol";
import "/dapp/permission/contracts/Role.sol";

/**
 * NetworkOnboardingUserManager
 *
 * Entry point to create new user and access existing users
 *
 * #see NetworkOnboardingUser
 *
 * #return none
 */

contract NetworkOnboardingUserManager is RestStatus, Role {
    NetworkOnboardingPermissionManager permissionManager;

    mapping(address => Role) private userRoles;

    /**
     * Constructor
     */
    constructor(address _permissionManager) public {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
    }

    // creates a user with no associated blockchain address, to be set later
    function registerUser(
        address _userAddress,
        string _userCertificate,
        Role _role
    ) public returns (uint256, address) {

        // check tx.origin's organization

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
        if (existingUser != address(0)) {
            return (RestStatus.CONFLICT, address(existingUser));
        }

        // create new
        registerCert(_userAddress, _userCertificate);
        userRoles[_userAddress] = _role;

        return (RestStatus.CREATED, address(user));
    }

    function updateUserCeritificate(
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

        userRoles[_userAddress] = _role;
    }

    function getRole(address _user) public view returns (Role) {
        return userRoles[_user];
    }
}
