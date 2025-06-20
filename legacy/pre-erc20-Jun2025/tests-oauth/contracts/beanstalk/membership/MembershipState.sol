/**
* Membership States Enums
*
* Membership FSM can have following states
*
* #see MembershipFSM
* #see MembershipManager
*
* #return none
*/

contract record MembershipState {
  enum MembershipState {
    NULL,
    REQUESTED,
    APPROVED,
    REJECTED,
    PROCESSING,
    ERROR,
    MAX
  }
}
