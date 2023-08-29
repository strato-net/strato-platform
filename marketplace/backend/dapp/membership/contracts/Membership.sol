
import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";


/// @title A representation of Membership assets
contract Membership_3 {

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public productId;
    int public timePeriodInMonths;
    string public additionalInfo;
    uint public createdDate;
    uint public taxPercentage;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
            address _productId
        ,   int _timePeriodInMonths
        ,   string _additionalInfo
        ,   uint _createdDate
        ,   uint _taxPercentage
    ) public {
        owner = tx.origin;
        
        productId = _productId;
        timePeriodInMonths = _timePeriodInMonths;
        additionalInfo = _additionalInfo;
        createdDate = _createdDate;
        taxPercentage = _taxPercentage;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        address _productId
    ,   int _timePeriodInMonths
    ,   string _additionalInfo
    ,   uint _createdDate
    ,uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        productId = _productId;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        timePeriodInMonths = _timePeriodInMonths;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        additionalInfo = _additionalInfo;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        createdDate = _createdDate;
      }

      return RestStatus.OK;
    }

    // Transfer the ownership of a Membership
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
