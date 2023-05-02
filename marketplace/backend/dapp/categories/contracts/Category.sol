 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "./SubCategory.sol";


/// @title A representation of Category assets
contract Category {

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public name;
    string public description;
    string public imageKey;
    uint public createdDate;

    /// @dev Events to add and remove members to this shard.
    event OrgAdded(string orgName);
    event OrgUnitAdded(string orgName, string orgUnit);
    event CommonNameAdded(string orgName, string orgUnit, string commonName); 

    event OrgRemoved(string orgName);
    event OrgUnitRemoved(string orgName, string orgUnit);
    event CommonNameRemoved(string orgName, string orgUnit, string commonName);


    constructor(
        string _appChainId,
            string _name
        ,   string _description
        ,   string _imageKey
        ,   uint _createdDate
    ) public {
        owner = tx.origin;
        appChainId = _appChainId;

        name = _name;
        description = _description;
        imageKey = _imageKey;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _name
    ,   string _description
    ,   string _imageKey
    ,uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        name = _name;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        description = _description;
      }
       if ((_scheme & (1 << 2)) == (1 << 2)) {
        imageKey = _imageKey;
      }

      return RestStatus.OK;
    }

      // Add the subCategory of a category
   function addSubCategory(string _name,string _description, uint _createdDate ) public returns(uint256, address){

      mapping(string => string) ownerCert = getUserCert(owner);
      ownerOrganization = ownerCert["organization"];

      SubCategory subCategory=new SubCategory(appChainId, _name, _description, _createdDate);
      return (RestStatus.OK,address(subCategory));
    }

       // Update the subCategory of a category
    function updateSubCategory(address _subCategory,string _name,string _description, uint _scheme) public returns(uint256,address){
    
      mapping(string => string) ownerCert = getUserCert(owner);
      ownerOrganization = ownerCert["organization"];

      SubCategory subCategory=SubCategory(_subCategory);
      subCategory.update(_name, _description, _scheme);
      return (RestStatus.OK,address(subCategory));
    }



// 
}
