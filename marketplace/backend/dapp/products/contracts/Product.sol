 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Inventory.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/UnitOfMeasurement.sol";
import "/dapp/products/contracts/InventoryStatus.sol";


/// @title A representation of Product assets
contract Product_4 is UnitOfMeasurement, InventoryStatus {

    address public owner;
    string public appChainId;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public name;
    string public description;
    string public manufacturer;
    UnitOfMeasurement public unitOfMeasurement;
    string public userUniqueProductCode;
    uint public uniqueProductCode;
    int public leastSellableUnit;
    string public imageKey;
    bool public isActive;
    string public category;
    string public subCategory;
    uint public createdDate;
    bool public isDeleted; 
    bool public isInventoryAvailable;  


    constructor(
            string _appChainId
        ,   string _name
        ,   string _description
        ,   string _manufacturer
        ,   UnitOfMeasurement _unitOfMeasurement
        ,   string _userUniqueProductCode
        ,   uint _uniqueProductCode
        ,   int _leastSellableUnit
        ,   string _imageKey
        ,   bool _isActive
        ,   string _category
        ,   string _subCategory
        ,   uint _createdDate
        ,   address _owner
    ) public {
        owner = _owner;
        appChainId = _appChainId;

        name = _name;
        description = _description;
        manufacturer = _manufacturer;
        unitOfMeasurement = _unitOfMeasurement;
        userUniqueProductCode = _userUniqueProductCode;
        uniqueProductCode = _uniqueProductCode;
        leastSellableUnit = _leastSellableUnit;
        imageKey = _imageKey;
        isActive = _isActive;
        category = _category;
        subCategory = _subCategory;
        createdDate = _createdDate;
        isDeleted = false;
        isInventoryAvailable = false;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        string _description
    ,   string _imageKey
    ,   bool _isActive
    ,   string _userUniqueProductCode
    ,   uint _scheme
    ) returns (uint) {
      if (tx.origin != owner) { return RestStatus.FORBIDDEN; }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        description = _description;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        imageKey = _imageKey;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        isActive = _isActive;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        userUniqueProductCode = _userUniqueProductCode;
      }

      return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
      mapping(string => string) ownerCert = getUserCert(caller);
      string userOrganization = ownerCert["organization"];
      return userOrganization;
    }

    // Delete the product
    function deleteProduct() public returns(uint256, string){
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return (RestStatus.FORBIDDEN, 'Not authorized');
      }

      if(!isInventoryAvailable) {
        isDeleted = true;
        return (RestStatus.OK, "Product is deleted successfully.");
      }
      return (RestStatus.CONFLICT, "Product cannot be deleted.");
    }

    // Add the inventory for the product
    function addInventory(int _quantity, int _pricePerUnit, string _batchId, 
      InventoryStatus _status, uint _createdDate,address _owner) public returns(uint256, address){

      if(ownerOrganization != getUserOrganization(_owner)){
        return (RestStatus.FORBIDDEN, address(0));
      }

      if(!isInventoryAvailable) {
        isInventoryAvailable = true;
      }
      Inventory inventory = new Inventory(appChainId, category, subCategory, _quantity, _pricePerUnit, _batchId, _status, _createdDate,_owner);
      return (RestStatus.OK, address(inventory));
    }

    // Update the inventory for product
    function updateInventory(address _inventory, int _pricePerUnit, InventoryStatus _status, uint _scheme) 
      public returns(uint256){
    
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }
    
      Inventory inventory = Inventory(_inventory);
      inventory.update(_pricePerUnit, _status, _scheme);
      return (RestStatus.OK);
    }


    // Update the inventory quantity
    function updateInventoryQuantity(address _inventory, int _quantity) 
      public returns(uint256){
    
      // if(ownerOrganization != getUserOrganization(tx.origin)){
      //   return RestStatus.FORBIDDEN;
      // }
    
      Inventory inventory = Inventory(_inventory);
      inventory.updateQuantity(_quantity);
      return (RestStatus.OK);
    }
}
