 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol"
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of Inventory assets
contract Inventory is InventoryStatus{

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public productId;
    string public category;
    string public subCategory;
    int public quantity;
    int public pricePerUnit;
    string public batchId;
    int public availableQuantity;
    string public inventoryType;
    InventoryStatus public status;
    uint public createdDate;


    constructor(
            string _category
        ,   string _subCategory
        ,   int _quantity
        ,   int _pricePerUnit
        ,   string _batchId
        ,   string _inventoryType
        ,   InventoryStatus _status
        ,   uint _createdDate
        ,   address _owner
    ) public {
        owner = _owner;

        productId = msg.sender;
        category = _category;
        subCategory = _subCategory;
        quantity = _quantity;
        pricePerUnit = _pricePerUnit;
        batchId = _batchId;
        availableQuantity = _quantity;
        inventoryType = _inventoryType;
        status = _status;
        createdDate = _createdDate;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        int _pricePerUnit
    ,   InventoryStatus _status
    ,   uint _scheme
    ) returns (uint) {
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        pricePerUnit = _pricePerUnit;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        status = _status;
      }

      return RestStatus.OK;
    }    

    function updateQuantity(int _quantity) returns(uint){
      availableQuantity = _quantity;
      return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
      mapping(string => string) ownerCert = getUserCert(caller);
      string userOrganization = ownerCert["organization"];
      return userOrganization;
    }
}