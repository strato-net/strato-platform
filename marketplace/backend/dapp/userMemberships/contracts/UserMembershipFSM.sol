import "/blockapps-sol/lib/fsm/contracts/FSM.sol";

import "./UserMembershipStateEnum.sol";
import "./UserMembershipEventEnum.sol";

contract UserMembershipFSM is FSM, UserMembershipStateEnum, UserMembershipEventEnum {
    constructor() public {
        addTransition(UserMembershipState.NEW, UserMembershipEvent.ACCEPT, UserMembershipState. ACCEPTED);
        addTransition(UserMembershipState.NEW, UserMembershipEvent.REJECT, UserMembershipState. REJECTED);
    }

    function handleEvent(UserMembershipState _state,UserMembershipEvent _event) public returns(UserMembershipState){
        return UserMembershipState(super.handleEvent(uint(_state), uint(_event)));
    }

    function addTransition(UserMembershipState _state, UserMembershipEvent _event, UserMembershipState _newState) internal {
      super.addTransition(uint(_state), uint(_event), uint(_newState));
    }
}