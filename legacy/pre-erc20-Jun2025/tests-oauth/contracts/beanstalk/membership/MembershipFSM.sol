import "../FSM.sol";

import "./MembershipState.sol";
import "./MembershipEvent.sol";

/**
* Beanstalk Membership State Machine Contract
*
* This contract defines valid state transitions for a membership
*
* #see MembershipState
* #see MembershipEvent
*
* #return none
*/

contract record MembershipFSM is FSM, MembershipState, MembershipEvent {

  /**
  * Constructor
  */
  constructor() public {
    addTransition(MembershipState.REQUESTED, MembershipEvent.APPROVE, MembershipState.PROCESSING);
    addTransition(MembershipState.PROCESSING, MembershipEvent.PROCESS, MembershipState.APPROVED);
    addTransition(MembershipState.ERROR, MembershipEvent.PROCESS, MembershipState.APPROVED);
    addTransition(MembershipState.REJECTED, MembershipEvent.APPROVE, MembershipState.PROCESSING);
    addTransition(MembershipState.PROCESSING, MembershipEvent.ERROR, MembershipState.ERROR);
    addTransition(MembershipState.REQUESTED, MembershipEvent.REJECT, MembershipState.REJECTED);
    addTransition(MembershipState.PROCESSING, MembershipEvent.REJECT, MembershipState.REJECTED);
    addTransition(MembershipState.APPROVED, MembershipEvent.REJECT, MembershipState.REJECTED);
    addTransition(MembershipState.ERROR, MembershipEvent.REJECT, MembershipState.REJECTED);
    addTransition(MembershipState.REQUESTED, MembershipEvent.REREQUEST, MembershipState.REQUESTED);
    addTransition(MembershipState.PROCESSING, MembershipEvent.REREQUEST, MembershipState.REQUESTED);
    addTransition(MembershipState.APPROVED, MembershipEvent.REREQUEST, MembershipState.REQUESTED);
    addTransition(MembershipState.ERROR, MembershipEvent.REREQUEST, MembershipState.REQUESTED);
  }

  // Approve or reject a membership
  function handleEvent(MembershipState _state, MembershipEvent _event) public returns (MembershipState) {
    return MembershipState(super.handleEvent(uint(_state), uint(_event)));
  }

  // Add a new transition in Membership FSM
  function addTransition(MembershipState _state, MembershipEvent _event, MembershipState _newState) internal {
    super.addTransition(uint(_state), uint(_event), uint(_newState));
  }
}
