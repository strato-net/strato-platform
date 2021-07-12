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

    mapping(string => address) private usernameMap; // username => contractAddress
    mapping(address => address) private usersMap; // blockchainAddress => contractAddress
    mapping(address => address) private userOrganizationsMap; // contractAddress => orgAddress

    /**
     * Constructor
     */
    constructor(address _permissionManager) public {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
    }

    // creates a user with no associated blockchain address, to be set later
    function createUser(
        string _username,
        string _enodeAddress,
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
        address existingUser = getUserByUsername(_username);
        if (existingUser != address(0)) {
            return (RestStatus.CONFLICT, address(existingUser));
        }

        // create new
        NetworkOnboardingUser user = new NetworkOnboardingUser(_username, _enodeAddress, _role);

        usernameMap[_username] = address(user);

        return (RestStatus.CREATED, address(user));
    }

    function setUserOrganization(string _username, address _organization)
        public
        returns (uint256, address)
    {
        // organization exists?
        Organization organization = Organization(_organization);
        if (address(organization) == 0) {
            return (RestStatus.BAD_REQUEST, address(tx.origin));
        }

        // check permissions
        if (!permissionManager.canUpdateUser(tx.origin)) {
            address adminUser = getUser(tx.origin);
            if (adminUser == address(0)) {
                return (RestStatus.UNAUTHORIZED, address(tx.origin));
            }
            address adminUserOrganization = getUserOrganization(adminUser);

            // if caller is an org_admin, they must be setting the user's org as theirs
            if (
                (adminUserOrganization == address(0)) ||
                !permissionManager.canUpdateUserLimited(tx.origin) ||
                (adminUserOrganization != _organization)
            ) {
                return (RestStatus.FORBIDDEN, address(tx.origin));
            }
        }

        // user exists?
        address user = getUserByUsername(_username);
        if (user == address(0)) {
            return (RestStatus.NOT_FOUND, address(0));
        }

        uint256 restStatus = user.setUserOrganization(organization);
        if (restStatus != RestStatus.OK) {
            return (restStatus, address(user));
        }

        userOrganizationsMap[address(user)] = address(organization);

        return (RestStatus.OK, address(user));
    }

    function setUserBlockchainAddress(
        string _username,
        address _blockchainAddress
    ) public returns (uint256, address) {
        // check permissions
        if (!permissionManager.canUpdateUser(tx.origin)) {
            address adminUser = getUser(tx.origin);
            if (adminUser == address(0)) {
                return (RestStatus.FORBIDDEN, address(tx.origin));
            }
            if (!permissionManager.canUpdateUserLimited(tx.origin)) {
                return (RestStatus.UNAUTHORIZED, address(tx.origin));
            }
        }

        // user exists in username map? (i.e initialized, not yet associated with an account address)
        address user = usernameMap[_username];
        if (user == address(0)) {
            return (RestStatus.NOT_FOUND, address(0));
        }

        // user's blockchainAddress already exists in userMap?
        address existingUser = getUser(_blockchainAddress);
        if (existingUser != address(0)) {
            return (RestStatus.CONFLICT, address(existingUser));
        }

        uint256 restStatus = user.setUserBlockchainAddress(_blockchainAddress);
        if (restStatus != RestStatus.OK) {
            return (restStatus, address(user));
        }

        usersMap[_blockchainAddress] = address(user);
        return (RestStatus.OK, address(user));
    }

    function getUser(address _blockchainAddress) public view returns (address) {
        return usersMap[_blockchainAddress];
    }

    function getUserByUsername(string _username) public view returns (address) {
        return usernameMap[_username];
    }

    function getUserOrganization(address _user) public view returns (address) {
        return userOrganizationsMap[_user];
    }
}
