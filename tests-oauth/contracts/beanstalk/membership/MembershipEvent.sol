/**
* Membership Events Enums
*
* Membership FSM accepts following events
*
* #see MembershipFSM
* #see MembershipManager
*
* #return none
*/

contract MembershipEvent {
  enum MembershipEvent {
    NULL,
    APPROVE,
    REJECT,
    PROCESS,
    ERROR,
    REREQUEST,
    MAX
  }
}
