pragma solidvm 3.0;

/**
 * Organization data contract
 * The Organization contract stores data pertinent to the organization, it will also expose a number
 * of functions for changing these data elements, some permissioned only to network admins, and
 * others permissioned to the organization admins).
 */
contract Organization {
  string public name;
  string public certificateString;
  string[] public members;
  Status public status;
  MembershipLevel public membershipLevel;
  UserInvitationManager public userInvitationManager;


  enum Status { Active, Removed };
  enum MembershipLevel { Network, Core, Contributing };


  function Organization(string _name, string _certificateString, string[] _members, Status _status, 
                   MembershipLevel _membershipLevel, UserInvitationManager _userInvitationManager) {
    name = _name;
    certificateString = _certificateString;
    members = _members;
    status = _status;
    membershipLevel = _membershipLevel;
    userInvitationManager = _userInvitationManager;
  }
}
