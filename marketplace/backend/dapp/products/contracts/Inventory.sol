 

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
    address public categoryId;
    address public subCategoryId;
    int public quantity;
    int public pricePerUnit;
    string public batchId;
    int public availableQuantity;
    InventoryStatus public status;
    uint public createdDate;


    constructor(
            address _categoryId
        ,   address _subCategoryId
        ,   int _quantity
        ,   int _pricePerUnit
        ,   string _batchId
        ,   InventoryStatus _status
        ,   uint _createdDate
        ,   address _owner
    ) public {
        owner = _owner;

        productId = msg.sender;
        categoryId = _categoryId;
        subCategoryId = _subCategoryId;
        quantity = _quantity;
        pricePerUnit = _pricePerUnit;
        batchId = _batchId;
        availableQuantity = _quantity;
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
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

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
      // if (tx.origin != owner) { return RestStatus.FORBIDDEN; }
      // if(_quantity > quantity){
      //   return RestStatus.BAD_REQUEST;
      // }
      availableQuantity = _quantity;
      return RestStatus.OK;
    }
}
