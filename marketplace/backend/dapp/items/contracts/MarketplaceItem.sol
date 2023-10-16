import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/items/rawMaterials/contracts/RawMaterial.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

contract MarketplaceItem is Asset, ItemStatus, InventoryStatus{
    address item_owner;
    string item_ownerOrganization;
    string item_ownerOrganizationalUnit;
    string item_ownerCommonName;
    address item_productId;
    address item_inventoryId;
    string item_serialNumber;
    string item_comment;
    uint item_itemNumber;
    uint item_createdDate;
    ItemStatus public item_status;

    // Inventory
    int public inventory_availableQuantity;
    string public inventory_batchId;
    string public inventory_category;
    uint public inventory_createdDate;
    address public inventory_owner;
    string public inventory_ownerCommonName;
    string public inventory_ownerOrganization;
    string public inventory_ownerOrganizationalUnit;
    int public inventory_pricePerUnit;
    address public inventory_productId;
    int public inventory_quantity;
    InventoryStatus public inventory_status;
    string public inventory_subCategory;
    string public inventory_type;

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
        int _inventory_availableQuantity,
        string _inventory_batchId,
        string _inventory_category,
        uint _inventory_createdDate,
        address _inventory_owner,
        int _inventory_pricePerUnit,
        address _inventory_productId,
        InventoryStatus _inventory_status,
        string _inventory_subCategory,
        string _inventory_type
    ) public {
        mapping(string => string) ownerCert = getUserCert(_owner);

        item = new Item();
        item_owner = _owner;
        item_productId = _productId;
        item_inventoryId = _inventoryId;
        item_serialNumber = _serialNumber;
        item_comment = _comment;
        item_itemNumber = _itemNumber;
        item_createdDate = _createdDate;
        item_status = _itemStatus;
        item_ownerOrganization = ownerCert["organization"];
        item_ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        item_ownerCommonName = ownerCert["commonName"];

        // Emit an event to indicate the creation of a new Item
        emit ItemOwnershipUpdate(address(0), _owner, block.timestamp, msg.sender);

        // Initialize product
        inventory_availableQuantity = _inventory_availableQuantity;
        inventory_batchId = _inventory_batchId;
        inventory_category = _inventory_category;
        inventory_createdDate = _inventory_createdDate;
        inventory_owner = _inventory_owner;
        inventory_pricePerUnit = _inventory_pricePerUnit;
        inventory_productId = _inventory_productId;
        inventory_quantity = _inventory_availableQuantity;
        inventory_status = _inventory_status;
        inventory_subCategory = _inventory_subCategory;
        inventory_type = _inventory_type;
        inventory_ownerCommonName = ownerCert["commonName"];
        inventory_ownerOrganization = ownerCert["organization"];
        inventory_ownerOrganizationalUnit = ownerCert["organizationalUnit"];

        if (_rawMaterialSerialNumber.length > 0) {
            addRawMaterials(
                _uniqueProductCode,
                _rawMaterialProductName,
                _rawMaterialSerialNumber,
                _rawMaterialProductId
            );
        }
    }

    // Function to update an Item
    function itemUpdate(
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) returns (uint) {
        if (item_ownerOrganization != getUserOrganization(tx.origin)) {
            return RestStatus.FORBIDDEN;
        }

        if (_scheme == 0) {
            return RestStatus.OK;
        }

        if ((_scheme & (1 << 0)) == (1 << 0)) {
            item_status = _status;
        }
        if ((_scheme & (1 << 1)) == (1 << 1)) {
            item_comment = _comment;
        }

        return RestStatus.OK;
    }

    // Function to update the Inventory
    function updateInventory(
        int _pricePerUnit
    ,   InventoryStatus _status
    ,   uint _scheme
    ) returns (uint) {
      if(inventory_ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        inventory_pricePerUnit = _pricePerUnit;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        inventory_status = _status;
      }

      return RestStatus.OK;
    }

    // Function to update the quantity of the Inventory
    function updateQuantity(int _quantity) returns(uint){
      inventory_availableQuantity = _quantity;
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
        uint _ownershipStartDate,
        address _itemAddress
    ) returns (uint) {
        Item item = items[_itemAddress]
        if (item_ownerOrganization != getUserOrganization(tx.origin)) {
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
        address _itemAddress,
        address _addr,
        address _productId,
        address _inventoryId
    ) public returns (uint256) {
        Item item = items[_itemAddress];
        // caller must be current owner to transfer ownership
        if (item_ownerOrganization != getUserOrganization(tx.origin)) {
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
            ownerOrganization,
            newOwnerOrganization,
            block.timestamp,
            _itemAddress
        );
        // set newOwner as asset owner
        item_owner = _addr;
        item_ownerOrganization = newOwnerOrganization;
        item_ownerOrganizationalUnit = newOwnerOrganizationalUnit;
        item_ownerCommonName = newOwnerCommonName;
        item_productId = _productId;
        item_inventoryId = _inventoryId;
        return RestStatus.OK;
    }

}
