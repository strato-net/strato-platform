import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/permission/contracts/NetworkOnboardingPermissionManager.sol";

import "./OrganizationMembershipState.sol";

/**
* OrganizationMembership container
*
* This container holds the data for an organization membership. This container is refrenced through
* a mapping of requesterAddress |-> OrganizationMembership inside OrganizationMembershipsManager
*
* #see OrganizationMembershipsManager
* #see OrganizationMembershipState
*
* #return none
*/

contract OrganizationMembership is RestStatus, OrganizationMembershipState {
    address public owner;   // The creator of this contract, i.e. OrganizationMembershipsManager
    string public requesterCommonName;
    string public organizationCommonName;
    OrganizationMembershipState public state;

    constructor(string _requesterCommonName, string _organizationCommonName) public {
        owner = msg.sender;
        requesterCommonName = _requesterCommonName;
        organizationCommonName = _organizationCommonName;
        state = OrganizationMembershipState.NEW;
    }

    /**
     * Set the membership state
     */
    function setState(OrganizationMembershipState _state) public returns (uint) {
        if (owner != msg.sender) return RestStatus.FORBIDDEN;   // pervents people from calling this directly

        state = _state;
        return RestStatus.OK;
    }
}
