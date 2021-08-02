/**
 * Application container
 *
 * This container holds the data for an application.
 *
 * #see ApplicationsManager
 *
 */

contract Application {
  address public owner;                     // address of ApplicationsManager
  
  string public name;                       // application name
  address public ownerOrganization;         // address of the org that owns this app 
  mapping(string => address) public organizations; // other orgs that participate in this app; NOT QUERYABLE

  constructor(
    string _name,
    address _ownerOrganization
  ) {
    owner = msg.sender;
    name = _name;
    ownerOrganization = _ownerOrganization;
  }

  function addOrganization(string _name, address _address) {
    if (organizations[_name] != address(0))
      organizations[_name] = _address;
  }

  function getApplicationOwner() returns (address) {
    return ownerOrganization;
  }
}
