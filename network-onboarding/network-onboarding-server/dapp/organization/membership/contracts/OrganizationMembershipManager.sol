import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/blockapps-sol/lib/util/contracts/Util.sol";

import "./OrganizationMembershipFSM.sol";
import "./OrganizationMembership.sol";
import "./OrganizationMembershipEvent.sol";
import "./OrganizationMembershipState.sol";

import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";
import "/dapp/permission/contracts/Role.sol";
import "/dapp/organization/contracts/OrganizationManager.sol";
import "/dapp/user-manager/contracts/NetworkOnboardingUserManager.sol";
import "/dapp/organization/contracts/OrganizationManager.sol";

/**
 * Manage the Organzations currently on the network (not the members of a particular organizations)
 */
contract OrganizationMembershipManager is
    RestStatus,
    Util,
    OrganizationMembershipEvent,
    OrganizationMembershipState,
    Role
{
    NetworkOnboardingPermissionManager permissionManager;
    OrganizationManager organizationManager;
    OrganizationMembershipFSM organizationMembershipFSM;

    mapping(address => address) private organizationMemberships; // :: requesterAddress |-> OrganizationMembership

    constructor(
        address _permissionManager,
        address _organizationManager
    ) public {
        permissionManager = NetworkOnboardingPermissionManager(_permissionManager);
        organizationManager = OrganizationManager(_organizationManager);
        organizationMembershipFSM = new OrganizationMembershipFSM();
    }

    function requestOrganizationMembership(
        string _requesterCommonName,
        string _organizationCommonName
    ) public returns (uint256, address) {
        address requesterAddress = tx.origin;
        address alreadyRequested = organizationMemberships[requesterAddress];

        // If organizationMembership is already requested and accepted - return CONFLICT.
        // If requested organizationMembership is new or rejected - rewrite it with the new one
        if (alreadyRequested != address(0)) {
            if (
                OrganizationMembership(alreadyRequested).state() == OrganizationMembershipState.ACCEPTED
            ) {
                return (RestStatus.CONFLICT, alreadyRequested);
            }
        }

        address organizationMembership =
            new OrganizationMembership(
                _requesterCommonName,
                _organizationCommonName
            );

        organizationMemberships[requesterAddress] = address(organizationMembership);

        return (RestStatus.CREATED, address(organizationMembership));
    }

    function handleOrganizationMembershipEvent(
        address _requesterAddress,          // Person who made the original request
        string _organizationCertificate,
        OrganizationMembershipEvent _organizationMembershipEvent
    ) public returns (uint256, OrganizationMembershipState) {

        OrganizationMembership organizationMembership = 
            OrganizationMembership(organizationMemberships[_requesterAddress]);

        // Does and organizationMembership exist already?
        if (address(organizationMembership) == 0)
            return (RestStatus.NOT_FOUND, OrganizationMembershipState.NULL);

        // Can tx.origin modify organization membership?
        if (!permissionManager.canModifyOrganizationMembership(tx.origin))
            return (RestStatus.FORBIDDEN, OrganizationMembershipState.NULL);

        OrganizationMembershipState newState =
            organizationMembershipFSM.handleEvent(organizationMembership.state(), _organizationMembershipEvent);

        // Is the state change (e.g. NEW -> ACCEPTED) valid?
        if (newState == OrganizationMembershipState.NULL)
            return (RestStatus.BAD_REQUEST, OrganizationMembershipState.NULL);

        // TODO Should we check information? Refer to Carbon for inspiration

        uint256 restStatusState = organizationMembership.setState(newState);

        if (newState == OrganizationMembershipState.ACCEPTED) {
            (uint256 restStatusOrganization, address organizationAddress) =
                organizationManager.createOrganization(_organizationCertificate);

            if (restStatusOrganization != RestStatus.CREATED) {
                OrganizationMembershipState rejectedState = OrganizationMembershipState.REJECTED;
                organizationMembership.setState(rejectedState);
                return (restStatusOrganization, rejectedState);
            }

            organizationMembership.setOrganization(organizationAddress);
        }

        if (newState == OrganizationMembershipState.REJECTED) {
            organizationMemberships[_requesterAddress] = address(0);
        }

        return (restStatusState, newState);
    }

    function getOrganizationMembership(address _requesterAddress)
        public
        view
        returns (address)
    {
        return organizationMemberships[_requesterAddress];
    }
}
