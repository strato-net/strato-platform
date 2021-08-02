/**
* OrganizationMembership Event Enums
*
* OrganizationMembership events in the Network OrganizationMembership Onboading app
*
* #see OrganizationMembershipFSM
* #see OrganizationMembershipsManager
*
* #return none
*/

contract OrganizationMembershipEvent {
    enum OrganizationMembershipEvent {
        NULL,
        ACCEPT,
        REJECT,
        MAX
    }
}
