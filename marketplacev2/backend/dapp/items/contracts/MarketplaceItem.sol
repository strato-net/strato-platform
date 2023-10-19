import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/items/rawMaterials/contracts/RawMaterial.sol";


contract MarketplaceItem is Asset, 
                            ItemStatus, 
                            InventoryStatus,
                            RestStatus
                             {
     // Item
    struct Item{
    address owner;
    string ownerOrganization;
    string ownerOrganizationalUnit;
    string ownerCommonName;
    address productId;
    address inventoryId;
    string serialNumber;
    string comment;
    uint itemNumber;
    uint createdDate;
    ItemStatus status;}

    // Inventory
    struct Inventory{
    int availableQuantity;
    string batchId;
    string category;
    uint createdDate;
    address owner;
    string ownerCommonName;
    string ownerOrganization;
    string ownerOrganizationalUnit;
    int pricePerUnit;
    address productId;
    int quantity;
    InventoryStatus status;
    string subCategory;
    string inventoryType;}

    // Product
    struct Product{ 
    string name;
    string description;
    string manufacturer;
    UnitOfMeasurement unitOfMeasurement;
    string userUniqueProductCode;
    uint uniqueProductCode;
    int leastSellableUnit;
    string imageKey;
    bool isActive;
    string category;
    string subCategory;
    uint createdDate;
    bool isDeleted; 
    bool isInventoryAvailable;}

    Item item;
    Product product;
    Inventory inventory;

    // Events
    event ItemOwnershipUpdate(address seller, address newOwner, uint ownershipStartDate, address itemAddress);

    constructor(
        address _owner,
        address _productId,
        address _inventoryId,
        string memory _serialNumber,
        string memory _comment,
        uint _itemNumber,
        uint _createdDate,
        ItemStatus _itemStatus,
        uint _uniqueProductCode,
        string[] _rawMaterialProductName,
        string[] _rawMaterialSerialNumber,
        string[] _rawMaterialProductId,
        int _availableQuantity,
        string _batchId,
        string _category,
        int _pricePerUnit,
        InventoryStatus _inventoryStatus,
        string _subCategory,
        string _inventoryType,
        string _name,
        string _description,
        string _manufacturer,
        UnitOfMeasurement _unitOfMeasurement,
        string _userUniqueProductCode,
        int _leastSellableUnit,
        string _imageKey,
        bool _isActive,
        bool _isDeleted,
        bool _isInventoryAvailable
    ) Asset() public {
        item = Item(
            _owner,
            _productId,
            _inventoryId,
            _serialNumber,
            _comment,
            _itemNumber,
            _createdDate,
            _itemStatus,
            ownerOrganization,
            ownerOrganizationalUnit,
            ownerCommonName
        );

        // Emit an event to indicate the creation of a new Item
        emit ItemOwnershipUpdate(address(0), _owner, block.timestamp, msg.sender);

        // Initialize inventory
        inventory = Inventory(
            _availableQuantity,
            _batchId,
            _category,
            _createdDate,
            _owner,
            ownerOrganization,
            ownerOrganizationalUnit,
            ownerCommonName,
            _pricePerUnit,
            _productId,
            _availableQuantity,
            _inventoryStatus,
            _subCategory,
            _inventoryType
        );

        if (_rawMaterialSerialNumber.length > 0) {
            addRawMaterials(
                _uniqueProductCode,
                _rawMaterialProductName,
                _rawMaterialSerialNumber,
                _rawMaterialProductId
            );
        }
        product = Product(
            _name,
            _description,
            _manufacturer,
            _unitOfMeasurement,
            _userUniqueProductCode,
            _uniqueProductCode,
            _leastSellableUnit,
            _imageKey,
            _isActive,
            _category,
            _subCategory,
            _createdDate,
            _isDeleted,
            _isInventoryAvailable
        );}

    // Function to update an Item
    function updateItem(
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) returns (uint) {
        if (item.ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            item.status = _status;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            item.comment = _comment;
        }

        return RestStatus.OK;
    }

    // Function to update the Inventory
    function updateInventory(
        int _pricePerUnit
    ,   InventoryStatus _status
    ,   uint _scheme
    ) returns (uint) {
      if(inventory.ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        inventory.pricePerUnit = _pricePerUnit;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        inventory.status = _status;
      }

      return RestStatus.OK;
    }
    
    function updateProduct(
        string _description
    ,   string _imageKey
    ,   bool _isActive
    ,   string _userUniqueProductCode
    ,   uint _scheme
    ) returns (uint) {
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        product.description = _description;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        product.imageKey = _imageKey;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        product.isActive = _isActive;
      }
      if ((_scheme & (1 << 3)) == (1 << 3)) {
        product.userUniqueProductCode = _userUniqueProductCode;
      }

      return RestStatus.OK;
    }

    // Delete the product
    function deleteProduct() public returns(uint256, string){
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return (RestStatus.FORBIDDEN, 'Not authorized');
      }

      if(!product.isInventoryAvailable) {
        product.isDeleted = true;
        return (RestStatus.OK, "Product is deleted successfully.");
      }
      return (RestStatus.CONFLICT, "Product cannot be deleted.");
    }

    // Function to update the quantity of the Inventory
    function updateQuantity(int _quantity) returns(uint){
      inventory.availableQuantity = _quantity;
      return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(caller);
        string userOrganization = ownerCert["organization"];
        return userOrganization;
    }

    function generateOwnershipHistory(
        string _seller,
        string _newOwner,
        uint _ownershipStartDate
    ) returns (uint) {
        if (item.ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }
        emit ItemOwnershipUpdate(
            _seller,
            _newOwner,
            _ownershipStartDate,
            _itemAddress
        );
        return RestStatus.OK;
    }

    // Function to transfer the ownership of a Item
    function transferOwnership(
        address _addr,
        address _productId,
        address _inventoryId
    ) public returns (uint256) {
        // caller must be current owner to transfer ownership
        if (item.ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        // fetch new owner cert details (org and unit)
        mapping(string => string) newOwnerCert = getUserCert(_addr);
        string newOwnerOrganization = newOwnerCert["organization"];
        string newOwnerOrganizationalUnit = newOwnerCert["organizationalUnit"];
        string newOwnerCommonName = newOwnerCert["commonName"];

        // add new owner org (and maybe unit)
        if (newOwnerOrganization == "") return RestStatus.NOT_FOUND;

        generateOwnershipHistory(
            item.ownerOrganization,
            newOwnerOrganization,
            block.timestamp
        );
        // set newOwner as asset owner
        ownerOrganization = newOwnerOrganization,
        ownerOrganizationalUnit = newOwnerOrganizationalUnit,
        ownerCommonName = newOwnerCommonName,
        item.owner = _addr;
        item.ownerOrganization = ownerOrganization;
        item.ownerOrganizationalUnit = ownerOrganizationalUnit;
        item.ownerCommonName = ownerCommonName;
        inventory.owner = _addr;
        inventory.ownerOrganization = ownerOrganization;
        inventory.ownerOrganizationalUnit = ownerOrganizationalUnit;
        inventory.ownerCommonName = ownerCommonName;
        item.productId = _productId;
        item.inventoryId = _inventoryId;
        return RestStatus.OK;
    }

    // Update the inventory for product
    function updateInventory(int _pricePerUnit, InventoryStatus _status, uint _scheme) 
      public returns(uint256){
    
      if(inventory.ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }
    
      inventory.updateInventory(_pricePerUnit, _status, _scheme);
      return (RestStatus.OK);
    }


    // Update the inventory quantity
    function updateInventoryQuantity(int _quantity) 
      public returns(uint256){
      inventory.updateQuantity(_quantity);
      return (RestStatus.OK);
    }
}