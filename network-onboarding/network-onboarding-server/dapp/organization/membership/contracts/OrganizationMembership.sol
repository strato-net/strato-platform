import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";

import "./OrganizationMembershipState.sol";

/**
* OrganizationMembership container
*
* This container holds the data for an organization membership.
*
* #see OrganizationMembershipManager
* #see OrganizationMembershipState
*
* #return none
*/

contract OrganizationMembership is RestStatus, OrganizationMembershipState {
    address public owner;                   // The original contract that instantiated this one
    string public requesterCommonName;
    string public organizationCommonName;
    address public organization;

    OrganizationMembershipState public state;

    constructor(string _organizationCommonName, string _requesterCommonName) public {
        owner = msg.sender;
        organizationCommonName = _organizationCommonName;
        requesterCommonName = _requesterCommonName;
        state = OrganizationMembershipState.NEW;
    }

    function setState(OrganizationMembershipState _state) public returns (uint) {
        if (owner != msg.sender) return RestStatus.FORBIDDEN;   // pervents people from calling this directly

        state = _state;
        return RestStatus.OK;
    }

    function setOrganization(address _organization) public returns (uint) {
        if (owner != msg.sender) return RestStatus.FORBIDDEN;

        organization = _organization;
        return RestStatus.OK;
    }
}
