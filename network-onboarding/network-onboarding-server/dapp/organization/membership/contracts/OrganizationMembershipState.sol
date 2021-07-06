/**
* OrganizationMembership State Enums
*
* OrganizationMembership states in the Carbon main chain
*
* #see OrganizationMembershipFSM
* #see OrganizationMembershipManager
*
* #return none
*/

contract OrganizationMembershipState {
    enum OrganizationMembershipState {
        NULL,
        NEW,
        ACCEPTED,
        REJECTED,
        MAX
    }
}
