/**
 * Organization data contract
 * The Organization contract stores data pertinent to the organization, it will also expose a number
 * of functions for changing these data elements, some permissioned only to network admins, and
 * others permissioned to the organization admins).
 *
 * Holds data for an organization, including the current members of the organization
 */
contract Organization {
    address public owner;    // Ties the Organization contract with the OrganizationManager
    string public commonName;
    string public certificateString;
    string[] public members;
    // UserInvitationManager userInvitationManager;

    constructor(string _commonName, string _certificateString) {
        owner = msg.sender;
        commonName = _commonName;
        certificateString = _certificateString;
        members = [];
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
