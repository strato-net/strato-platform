import "./data/Organization.sol";
import "./enums/OrganizationType.sol";

contract OrganizationManager is OrganizationType {
  mapping (string => Organization) dataMap;

  modifier nameAvailable(string name) {
    if (uint(dataMap[name]) == 0) {
      _
    } else throw;
  }

  /**
    * Check if an organization exists by name
    * @param name {string} - name of org to check
    * @return {bool} - whether or not the org exists
  */
  function exists(string name) constant returns (bool) {
    return uint(dataMap[name]) != 0;
  }

  /**
    * Get org address by orgName
    * @param orgName {string} - name of org to lookup
    * @return {address} - org address
  */
  function getAddressByName(string orgName) constant returns (address){
    return address(dataMap[orgName]);
  }

  /**
    * Add a new org
    * @param orgName {string} - name of new org
    * @param orgType {OrganizationTypeEnum} - type of new org
    * @param shippingAddress {Address} - default postal address for the organization
  */
  function add(string orgName, OrganizationTypeEnum orgType, Address shippingAddress) nameAvailable(orgName) {
    dataMap[orgName] = new Organization(orgName, orgType, shippingAddress);
  }

  function addFix(string orgName, OrganizationTypeEnum orgType, address shippingAddress) nameAvailable(orgName) {
    Address addressContract = Address(shippingAddress);
    add(orgName, orgType, addressContract);
  }

  /**
    * Add postal address to org
    * @param orgName {string} - name of org to receive address
    * @param fullName {string} - full name of recipient/shipper
    * @param street {string} - street address
    * @param city {string} - city
    * @param state {string} - state info
    * @param zip {string} - zip code
    * @return {bool} - true if no-throw
  */
  function newPostalAddress(string orgName, string fullName, string street, string city, string state, string zip) returns (bool) {
    if (!exists(orgName)) throw;
    dataMap[orgName].newPostalAddress(fullName, street, city, state, zip);
    return true;
  }

  /**
    * Remove postal address from org
    * @param orgName {string} - name of org to have address removed
    * @param id {uint} - index of the address to remove from the org
  */
  function removePostalAddress(string orgName, uint id) {
    dataMap[orgName].removePostalAddress(id);
  }

  /**
    * Set the default address for an organization
    * @param orgName {string} - name of org to have default updated
    * @param id {uint} - index of the address to set as default
  */
  function setDefault(string orgName, uint id) {
    dataMap[orgName].setDefault(id);
  }
}
