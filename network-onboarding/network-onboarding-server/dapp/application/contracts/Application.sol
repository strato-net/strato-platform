/**
 * Application container
 *
 * This container holds the data for an application.
 *
 * #see ApplicationManager
 *
 */

contract Application {
  address public owner;               // address of ApplicationManager
  
  string public name;                 // application name
  address public ownerOrganization;   // address of the org that owns this app 
  address[] organizations;            // other orgs that participate in this app

  constructor(
    string _name,
    string _ownerOrganization
  ) {
    owner = msg.sender;
    name = _name;
    ownerOrganization = _ownerOrganization;
  }
}
