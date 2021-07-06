/**
 * Organization data contract
 * The Organization contract stores data pertinent to the organization, it will also expose a number
 * of functions for changing these data elements, some permissioned only to network admins, and
 * others permissioned to the organization admins).
 *
 * Holds data for an organization, including the current members of the organization
 */
contract Organization {
    address public owner    // Ties the Organization contract with the OrganizationManager
    string public name;
    string public certificateString;
    string[] public members;
    Status public status;
    MembershipLevel public membershipLevel;
    MembershipState public membershipState;
    // UserInvitationManager userInvitationManager;


    enum Status { Active, Removed };
    enum MembershipLevel { Network, Core, Contributing };
    enum MembershipState { NULL, NEW, ACCEPTED, REJECTED, MAX };


    constructor(string _name, string _certificateString, string[] _members, Status _status, 
                    MembershipLevel _membershipLevel) {
        onwer = msg.sender;
        name = _name;
        certificateString = _certificateString;
        members = _members;
        status = _status;
        membershipLevel = _membershipLevel;
        // userInvitationManager = UserInvitationManager();
    }

    function revoke() {
        status = Removed;
    }
  
    function addMember(string _member) {
        members.push(_member);
    }

    function removeMember(string _member) {
        // TODO
    }
}
