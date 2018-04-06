import "../data/Address.sol";
import "../libs/Addressed.sol";
import "../enums/OrganizationType.sol";
import "../libs/Owned.sol";

contract Organization is OrganizationType, Owned, Addressed {
  string name;
  OrganizationTypeEnum orgType;
  Address[] shippingAddresses;
  uint defaultAddress;

  /**
    * Constructor
    * @param _name {string} - name of org
    * @return _orgType {OrganizationTypeEnum} - type of organizatin
  */
  function Organization(string _name, OrganizationTypeEnum _orgType, Address shippingAddress) {
    // check for non-address and throw
    name = _name;
    orgType = _orgType;
    shippingAddresses.length = 1;
    shippingAddresses.push(shippingAddress);
    defaultAddress = 1;
  }

  /**
    * Edit name and type of org
    * @param _name {string} - name of org
    * @return _orgType {OrganizationTypeEnum} - type of organizatin
  */
  function edit(string _name, OrganizationTypeEnum _orgType) isOwner {
    name = _name;
    orgType = _orgType;
  }

  /**
    * Create a new postal address
    * @param fullName {string} - full name of shipper/recip
    * @param street {string} - street address
    * @param city {string} - city name
    * @param state {string} - state info
    * @param zip {string} - zip code
  */
  function newPostalAddress(string fullName, string street, string city, string state, string zip) isOwner {
    if (defaultAddress == 0)
      defaultAddress = shippingAddresses.length;

    shippingAddresses.push(new Address(fullName, street, city, state, zip));
  }

  /**
    * Remove a postal address by id. If the default is assigned to this ID, reset it to zero
    * @param id {uint} - index of the postal address for this org
    * @return {bool} - return true if no-throw
  */
  function removePostalAddress(uint id) isOwner returns (bool) {
    // throw if already removed
    if (uint(shippingAddresses[id]) == 0) throw;

    uint firstAddress = 0;

    for (uint i = 1; firstAddress == 0 && i < shippingAddresses.length; i++) {
      if (i != id && uint(shippingAddresses[i]) > 0)
        firstAddress = i;
    }

    // throw if there is no more addresses left
    if (firstAddress == 0) throw;

    if (defaultAddress == id)
      defaultAddress = firstAddress;

    delete shippingAddresses[id];
    return true;
  }

  /**
    * Set a default address
    * @param id {uint} - index of the postal address to assign as default
  */
  function setDefault(uint id) isOwner {
    if (id > shippingAddresses.length) throw;
    defaultAddress = id;
  }

  /**
    * Retreive address information at a given index
    * @param id {uint} - index of the postal address to retreive
    * @return {string, string, string, string} - address details
  */
  function getPostalAddressAt(uint id) constant returns (string) {
    return addressJson(shippingAddresses[id]);
  }

  /**
    * Get the number of postal addresses saved for this org
    * @return {uint} - address count
  */
  function getPostalAddressCount() constant returns (uint) {
    return shippingAddresses.length;
  }

  /**
    * Get the default postal address for this org
    * @return {string, string, string, string} - address details
  */
  function getDefaultPostalAddress() constant returns (string) {
    return getPostalAddressAt(defaultAddress);
  }

  /**
    * Get the basic details of this org
    * @return {string, OrganizationTypeEnum} - name and type of this org
  */
  function get() constant returns (string, OrganizationTypeEnum, Address) {
    return (name, orgType, shippingAddresses[defaultAddress]);
  }

}
