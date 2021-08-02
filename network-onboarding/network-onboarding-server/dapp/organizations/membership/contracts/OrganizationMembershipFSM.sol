import "/blockapps-sol/lib/fsm/contracts/FSM.sol";

import "./OrganizationMembershipState.sol";
import "./OrganizationMembershipEvent.sol";

contract OrganizationMembershipFSM is FSM, OrganizationMembershipState, OrganizationMembershipEvent {
    constructor() public {
        addTransition(OrganizationMembershipState.NEW, OrganizationMembershipEvent.ACCEPT, OrganizationMembershipState.ACCEPTED);
        addTransition(OrganizationMembershipState.NEW, OrganizationMembershipEvent.REJECT, OrganizationMembershipState.REJECTED);
    }

    function handleEvent(OrganizationMembershipState _state, OrganizationMembershipEvent _event) public returns (OrganizationMembershipState) {
        return OrganizationMembershipState(super.handleEvent(uint(_state), uint(_event)));
    }

    function addTransition(OrganizationMembershipState _state, OrganizationMembershipEvent _event, OrganizationMembershipState _newState) internal {
      super.addTransition(uint(_state), uint(_event), uint(_newState));
    }
}
