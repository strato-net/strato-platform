/**
* OrganizationMembership Event Enums
*
* OrganizationMembership events in the Network OrganizationMembership Onboading app
*
* #see OrganizationMembershipFSM
* #see OrganizationMembershipManager
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
