import "/dapp/user/contracts/NetworkOnboardingUser.sol";

/**
 * Organization data contract
 * The Organization contract stores data pertinent to the organization, it will also expose a number
 * of functions for changing these data elements, some permissioned only to network admins, and
 * others permissioned to the organization admins).
 *
 * Holds data for an organization, including the current members of the organization
 */
contract Organization {
    address public owner;    // Ties the Organization contract with the OrganizationManager
    // string public commonName;
    string public certificateString;    // Intermediate certificate for an organization
    address[] public members;

    constructor(string _certificateString) {
        owner = msg.sender;
        // commonName = parseCert(_commonName)["commonName"];
        certificateString = _certificateString;
        members = [];
    }

    function addMember(address _user) returns (uint256) {
        // user exists
        NetworkOnboardingUser user = NetworkOnboardingUser(_member);
        if (address(user) == 0) return (RestStatus.NOT_FOUND, 0);

        // TODO Add more verification to adding members

        members.push(_member);
    }

    function removeMember(address _member) {
        // TODO
    }
}
