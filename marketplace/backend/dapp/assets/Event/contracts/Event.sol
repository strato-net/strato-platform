 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Event assets
contract Event {

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public eventTypeId;
    string public itemSerialNumber;
    string public itemNFTAddress;
    string public date;
    string public inventoryId;
    string public productId;
    string public summary;
    string public certifiedBy;
    string public certifiedDate;
    string public createdAt;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
        string _appChainId,
            string _eventTypeId
        ,   string _itemSerialNumber
        ,   string _itemNFTAddress
        ,   string _date
        ,   string _inventoryId
        ,   string _productId
        ,   string _summary
        ,   string _certifiedBy
        ,   string _certifiedDate
        ,   string _createdAt
    ) public {
        owner = msg.sender;
        appChainId = _appChainId;

        eventTypeId = _eventTypeId;
        itemSerialNumber = _itemSerialNumber;
        itemNFTAddress = _itemNFTAddress;
        date = _date;
        inventoryId = _inventoryId;
        productId = _productId;
        summary = _summary;
        certifiedBy = _certifiedBy;
        certifiedDate = _certifiedDate;
        createdAt = _createdAt;

        mapping(string => string) ownerCert = getUserCert(msg.sender);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _eventTypeId
    ,   string _itemSerialNumber
    ,   string _itemNFTAddress
    ,   string _date
    ,   string _inventoryId
    ,   string _productId
    ,   string _summary
    ,   string _certifiedBy
    ,   string _certifiedDate
    ,   string _createdAt
    ,uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        eventTypeId = _eventTypeId;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        itemSerialNumber = _itemSerialNumber;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        itemNFTAddress = _itemNFTAddress;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        date = _date;
      }
      if ((_scheme & (1 << 4)) == (1 << 4)) {
        inventoryId = _inventoryId;
      }
      if ((_scheme & (1 << 5)) == (1 << 5)) {
        productId = _productId;
      }
      if ((_scheme & (1 << 6)) == (1 << 6)) {
        summary = _summary;
      }
      if ((_scheme & (1 << 7)) == (1 << 7)) {
        certifiedBy = _certifiedBy;
      }
      if ((_scheme & (1 << 8)) == (1 << 8)) {
        certifiedDate = _certifiedDate;
      }
      if ((_scheme & (1 << 9)) == (1 << 9)) {
        createdAt = _createdAt;
      }

      return RestStatus.OK;
    }

    // Transfer the ownership of a Event
    function transferOwnership(address _addr) public returns (uint256) {
      // caller must be current owner to transfer ownership
      if (tx.origin != owner) {
        return RestStatus.FORBIDDEN;
      }

      // fetch new owner cert details (org and unit)
      mapping(string => string) newOwnerCert = getUserCert(_addr);
      string newOwnerOrganization = newOwnerCert["organization"];
      string newOwnerOrganizationalUnit = newOwnerCert["organizationalUnit"];
      string newOwnerCommonName = newOwnerCert["commonName"];

      // add new owner org (and maybe unit)
      if (newOwnerOrganization == "") 
        return RestStatus.NOT_FOUND;
      else if (newOwnerOrganizationalUnit == "")
        addOrg(newOwnerOrganization);
      else
        addOrgUnit(newOwnerOrganization, newOwnerOrganizationalUnit);

      // remove old owner org (and maybe unit)
      if (ownerOrganizationalUnit == "")
        removeOrg(ownerOrganization);
      else
        removeOrgUnit(ownerOrganization, ownerOrganizationalUnit);

      // set newOwner as asset owner
      owner = _addr;
      ownerOrganization = newOwnerOrganization;
      ownerOrganizationalUnit = newOwnerOrganizationalUnit;
      ownerCommonName = newOwnerCommonName;

      return RestStatus.OK;

    } 

// ------------------- ASSET SHARD MEMBERSHIP FUNCTIONS ---------------

    // Add an organization to the chain
    function addOrg(string _orgName) {
      assert(tx.origin == owner);
      emit OrgAdded(_orgName);
    }

    // Add an organization unit to the chain
    function addOrgUnit(string _orgName, string _orgUnit) {
      assert(tx.origin == owner);
      emit OrgUnitAdded(_orgName, _orgUnit);
    }

    // Add a member to the chain
    function addMember(string _orgName, string _orgUnit, string _commonName) { 
      assert(tx.origin == owner);
      emit CommonNameAdded(_orgName, _orgUnit, _commonName); 
    } 

    // Remove an organization from the chain
    function removeOrg(string _orgName) {
      assert(tx.origin == owner);
      emit OrgRemoved(_orgName);
    }

    // Remove an organization unit from the chain
    function removeOrgUnit(string _orgName, string _orgUnit) {
      assert(tx.origin == owner);
      emit OrgUnitRemoved(_orgName, _orgUnit);
    }
    
    // Remove a member from the chain
    function removeMember(string _orgName, string _orgUnit, string _commonName) { 
      assert(tx.origin == owner);
      emit CommonNameRemoved(_orgName, _orgUnit, _commonName);  
    }

    // Bulk add organizations to the chain
    function addOrgs(string[] _orgNames) public returns (uint256) {
        assert(tx.origin == owner);
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addOrg(_orgNames[i]);
        }
        return RestStatus.OK;
    }

    // Bulk add organization units to the chain
    function addOrgUnits(string[] _orgNames, string[] _orgUnits) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addOrgUnit(_orgNames[i], _orgUnits[i]);
        }
        return RestStatus.OK;
    }

    // Bulk add members to the chain
    function addMembers(string[] _orgNames, string[] _orgUnits, string[] _commonNames ) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length && _orgUnits.length == _commonNames.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            addMember(_orgNames[i], _orgUnits[i], _commonNames[i]);
        }
        return RestStatus.OK;
    }

    // Bulk remove organizations from the chain
    function removeOrgs(string[] _orgNames) public returns (uint256) {
        assert(tx.origin == owner);
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeOrg(_orgNames[i]);
        }
        return RestStatus.OK;
    }

    // Bulk remove organization units from the chain
    function removeOrgUnits(string[] _orgNames, string[] _orgUnits) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeOrgUnit(_orgNames[i], _orgUnits[i]);
        }
        return RestStatus.OK;
    }

    // Bulk remove members from the chain
    function removeMembers(string[] _orgNames, string[] _orgUnits, string[] _commonNames ) public returns (uint256) {
        assert(tx.origin == owner);
        require((_orgNames.length == _orgUnits.length && _orgUnits.length == _commonNames.length), "Input data should be consistent");
        for (uint256 i = 0; i < _orgNames.length; i++) {
            removeMember(_orgNames[i], _orgUnits[i], _commonNames[i]);
        }
        return RestStatus.OK;
    }
}
