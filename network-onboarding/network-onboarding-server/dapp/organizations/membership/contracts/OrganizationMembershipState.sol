/**
* OrganizationMembership State Enums
*
* OrganizationMembership states in the Carbon main chain
*
* #see OrganizationMembershipFSM
* #see OrganizationMembershipsManager
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
