import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/MarketplaceItem.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/items/contracts/UnitOfMeasurement.sol";

/// @title A representation of ItemManager to manage items
contract MarketplaceItemManager is ItemStatus, 
                                   InventoryStatus, 
                                   MarketplaceItem,
                                   RestStatus,
                                   UnitOfMeasurement
                                    {
    // Check if the serial number is mapping(serialNumber => UPC ) uniqueSerialNumberByUPC;
    mapping(string => uint) private uniqueSerialNumberByUPC;
    mapping(address => address) private marketplaceItemProductIdMapping;
    mapping(address => address) private marketplaceItemInventoryIdMapping;
    mapping(address => address[]) private productToMarketplaceItemMapping;
    mapping(address => address) record mItemToProduct;
    
    struct ItemObject {
        uint itemNumber;
        string serialNumber;
        string[] rawMaterialProductName;
        string[] rawMaterialSerialNumber;
        string[] rawMaterialProductId;
    }

    function addMarketplaceItem(
        address _productId,
        address _inventoryId,
        uint _uniqueProductCode,
        ItemObject[] _itemObject,
        ItemStatus _status,
        string _comment,
        uint _createdDate
        string _name,
        string _description,
        string _manufacturer,
        UnitOfMeasurement _unitOfMeasurement,
        string _userUniqueProductCode,
        int _leastSellableUnit,
        string _imageKey,
        bool _isActive,
        string _category,
        string _subCategory,
        int _quantity,
        int _pricePerUnit,
        string _batchId,
        string _inventoryType,
        InventoryStatus _inventoryStatus
    ) public returns (uint, string, string) {
        string itemAddresses = "";
        string repeatedSerialNumbers = "";

        if (_itemObject[0].serialNumber == "") {
            for (uint256 i = 0; i < _itemObject.length; i++) {
                // Create new MarketplaceItem
                MarketplaceItem itemAddr = new MarketplaceItem(
                    tx.origin,
                    _productId,
                    _inventoryId,
                    _itemObject[i].serialNumber,
                    _comment,
                    _itemObject[i].itemNumber,
                    _createdDate,
                    _status,
                    _uniqueProductCode,
                    _itemObject[i].rawMaterialProductName,
                    _itemObject[i].rawMaterialSerialNumber,
                    _itemObject[i].rawMaterialProductId,
                    _quantity,
                    _batchId,
                    _category,
                    _pricePerUnit,
                    _inventoryStatus,
                    _subCategory,
                    _inventoryType,
                    _name,
                    _description,
                    _manufacturer,
                    _unitOfMeasurement,
                    _userUniqueProductCode,
                    _leastSellableUnit,
                    _imageKey,
                    _isActive,
                    _isDeleted,
                    _isInventoryAvailable
                );

                string _organization = getOrganization(tx.origin);
                orgToUPCToProduct[_organization][_uniqueProductCode] = address(product);


                address itemContractAddress = address(itemAddr);
                itemAddr.generateOwnershipHistory(
                    "",
                    itemAddr.ownerOrganization(),
                    _createdDate
                );

                uniqueSerialNumberByUPC[
                    _itemObject[0].serialNumber
                ] = _uniqueProductCode;
                marketplaceItemProductIdMapping[itemContractAddress] = _productId;
                marketplaceItemInventoryIdMapping[itemContractAddress] = _inventoryId;
                productToMarketplaceItemMapping[_productId].push(item);
                itemAddresses += string(address(itemAddr)) + ",";
            }
            
            return (RestStatus.OK, itemAddresses, repeatedSerialNumbers);
        }

        for (uint256 i = 0; i < _itemObject.length; i++) {
            string currentSerialNumber = _itemObject[i].serialNumber;
            uint existingUPC = uniqueSerialNumberByUPC[currentSerialNumber];

            if (existingUPC == _uniqueProductCode) {
                repeatedSerialNumbers += currentSerialNumber + ",";
            } else {
                MarketplaceItem itemAddr = new MarketplaceItem(
                    tx.origin,
                    _productId,
                    _inventoryId,
                    _itemObject[i].serialNumber,
                    _comment,
                    _itemObject[i].itemNumber,
                    _createdDate,
                    _status,
                    _uniqueProductCode,
                    _itemObject[i].rawMaterialProductName,
                    _itemObject[i].rawMaterialSerialNumber,
                    _itemObject[i].rawMaterialProductId,
                    _quantity,
                    _batchId,
                    _category,
                    _pricePerUnit,
                    _inventoryStatus,
                    _subCategory,
                    _inventoryType,
                    _name,
                    _description,
                    _manufacturer,
                    _unitOfMeasurement,
                    _userUniqueProductCode,
                    _leastSellableUnit,
                    _imageKey,
                    _isActive,
                    _isDeleted,
                    _isInventoryAvailable
                );

                string _organization = getOrganization(tx.origin);
                orgToUPCToProduct[_organization][_uniqueProductCode] = address(product);

                address itemContractAddress = address(itemAddr);
                itemAddr.generateOwnershipHistory(
                    "",
                    itemAddr.ownerOrganization(),
                    _createdDate
                );

                uniqueSerialNumberByUPC[
                    currentSerialNumber
                ] = _uniqueProductCode;
                marketplaceItemProductIdMapping[itemContractAddress] = _productId;
                marketplaceItemInventoryIdMapping[itemContractAddress] = _inventoryId;
                itemAddresses += string(address(itemAddr)) + ",";
            }
        }

        return (RestStatus.OK, itemAddresses, repeatedSerialNumbers);
    }

    //DONE
    function updateItem(
        address[] _itemsAddress,
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) public returns (uint) {
        for (uint256 i = 0; i < _itemsAddress.length; i++) {
            MarketplaceItem mi = MarketplaceItem(_itemsAddress[i]);
            mi.updateItem(_status, _comment, _scheme);
        }
        return (RestStatus.OK);
    }

    //DONE
    function addEvent(
        address[] _itemsAddress,
        address _eventTypeId,
        string _eventBatchId,
        uint _date,
        string _summary,
        address _certifier,
        uint _createdDate
    ) public returns (uint, string) {
        string eventAddresses = "";

        for (uint256 i = 0; i < _itemsAddress.length; i++) {
            address _itemAddress = _itemsAddress[i];
            MarketplaceItem item = MarketplaceItem(_itemAddress);
            string _itemSerialNumber = item.serialNumber();

            Event eventAddr = new Event(
                _eventTypeId,
                _eventBatchId,
                _itemSerialNumber,
                _itemAddress,
                _date,
                _summary,
                _certifier,
                _createdDate
            );

            eventAddresses += string(address(eventAddr)) + ",";
        }
        return (RestStatus.CREATED, eventAddresses);
    }
    //DONE
    function certifyEvent(
        address[] _eventAddress,
        string _certifierComment,
        uint _certifiedDate,
        uint _scheme
    ) public returns (uint, string) {
        for (uint256 i = 0; i < _eventAddress.length; i++) {
            Event eventAddr = Event(_eventAddress[i]);
            uint status = eventAddr.certify(
                _certifierComment,
                _certifiedDate,
                _scheme
            );
            if (status == RestStatus.FORBIDDEN) {
                // break the loop and return FORBIDDEN status
                return (
                    RestStatus.FORBIDDEN,
                    "User should be the Assigned Certifier"
                );
            }
        }
        return (RestStatus.OK, "event has been certified");
    }

    function transferOwnership(
        address[] _itemsAddress,
        address _newOwner,
        address _dappAddress,
        int _newQuantity,
        uint _itemNumber
    ) public returns (uint, address, address) {

        MarketplaceItem mItem = MarketplaceItem(_itemsAddress[0]);
        Dapp dapp = Dapp(address(_dappAddress));
        MarketplaceItemManager marketplaceItemManager = dapp.marketplaceItemManager();

        address productAddress = checkForProduct(
                mItem.product.uniqueProductCode(),
                _newOwner
                );

        address inventoryAddress = mItem.item.inventoryId();

        if (_mItem.item.inventoryType() == "Batch") {
                    addMarketplaceItem(
                    tx.origin,
                    productAddress,
                    inventoryAddress,
                    "",
                    "",
                    _itemNumber,
                    block.timestamp,
                    ItemStatus.UNPUBLISHED,
                    _uniqueProductCode,
                    [""],
                    [""],
                    [""],
                    _newQuantity,
                    _mItem.item.batchId,
                    _mItem.product.category,
                    _item.inventory.pricePerUnit,
                    InventoryStatus.UNPUBLISHED,
                    _mItem.product.subCategory,
                    _mItem.item.inventoryType,
                    _mItem.product.name,
                    _mItem.product.description,
                    _mItem.product.manufacturer,
                    _mItem.product.unitOfMeasurement,
                    _mItem.product.userUniqueProductCode,
                    _mItem.product.leastSellableUnit,
                    _mItem.product.imageKey,
                    _mItem.product.isActive,
                    _mItem.product.isDeleted,
                    _mItem.product.isInventoryAvailable
                );
        } else{
            updateInventory(_itemsAddress[i] ,_item.inventory.pricePerUnit, ,_item.inventory.status, ,_scheme);
            for (uint i = 0; i < _itemsAddress.length; i++) {
                MarketplaceItem _item = MarketplaceItem(_itemsAddress[i]);
                _item.transferOwnership(
                    _newOwner,
                    address(_item.product.productId),
                    address(_item.inventory.inventoryId)
                );
            }
        }
        return (RestStatus.OK, address(product), address(inventory));
    }

    function updateProduct(
        address _marketplaceItemAddress,
        string _description,
        string _imageKey,
        bool _isActive,
        string _userUniqueProductCode,
        uint _scheme
    ) returns (uint256) {
        MarketlplaceItem mi = MarketlplaceItem(_marketplaceItemAddress);
        return
            mi.updateProduct(
                _description,
                _imageKey,
                _isActive,
                _userUniqueProductCode,
                _scheme
            );
    }

    //DONE
    function deleteProduct(address _marketplaceItemAddress) returns (uint256, string) {
        MarketlplaceItem mi = MarketlplaceItem(_marketplaceItemAddress);
        address productID = marketplaceItemProductIdMapping[_marketplaceItemAddress];
        address[] addresses = productToMarketplaceItemMapping[productID];
        for (uint256 i = 0; i < addresses.length; i++) {
            MarketlplaceItem x = addresses[i];
            x.deleteProduct();
        }
        return (RestStatus.OK, "Products are deleted successfully.");
    }

    //DONE
    function updateInventory(
        address _marketplaceItemAddress,
        int _pricePerUnit,
        InventoryStatus _status,
        uint _scheme
    ) returns (uint256) {
        MarketlplaceItem mi = MarketlplaceItem(_marketplaceItemAddress);
        return
            mi.updateInventory(
                _pricePerUnit,
                _status,
                _scheme
            );
    }

    //DONE
    function updateInventoriesQuantities(
        address[] _marketplaceItems,
        int[] _quantities,
        bool _isReduce
    ) returns (uint256) {
        for (uint i = 0; i < _marketplaceItems.length; i++) {
            MarketplaceItem mi = MarketplaceItem(_marketplaceItems[i]);

            if (_isReduce) {
                if (_quantities[i] > mi.availableQuantity()) {
                    return RestStatus.BAD_REQUEST;
                }
                int quantityToDeduct = mi.inventory.availableQuantity() -
                    _quantities[i];
                mi.updateQuantity(quantityToDeduct);
            } else {
                int quantityToAdd = mi.inventory.availableQuantity() +
                    _quantities[i];

                if (quantityToAdd > mi.inventory.quantity()) {
                    return RestStatus.BAD_REQUEST;
                }
                mi.updateQuantity(quantityToAdd);
            }
        }
        return RestStatus.OK;
    }

    //DONE
    function resellInventory(
        address _existingMarketplaceItem,
        int _quantity,
        int _price,
        uint _itemNumber,
        address[] _itemsAddress,
        uint _scheme
    ) returns (uint256, address) {
        MarketplaceItem existingMarketplaceItem = MarketplaceItem(_existingMarketplaceItem);
        if (
            _quantity > existingMarketplaceItem.inventory.availableQuantity() || _quantity <= 0
        ) {
            return (RestStatus.BAD_REQUEST, address(0));
        }
        uint256 isUpdated = existingMarketplaceItem.updateQuantity(
            existingMarketplaceItem.inventory.availableQuantity() - _quantity
        );
        if (existingMarketplaceItem.inventory.inventoryType() == "Batch") {
            (uint256 status, address inventoryAddress) = existingMarketplaceItem.addInventory(
                _quantity,
                _price,
                existingMarketplaceItem.inventory.batchId(),
                existingMarketplaceItem.inventory.inventoryType(),
                InventoryStatus.PUBLISHED,
                block.timestamp,
                tx.origin
            );
            addMarketplaceItem(
                    tx.origin,
                    existingMarketplaceItem.product.productID,
                    existingMarketplaceItem.inventory.inventoryId,
                    "",
                    "",
                    _itemNumber,
                    block.timestamp,
                    ItemStatus.UNPUBLISHED,
                    _uniqueProductCode,
                    [""],
                    [""],
                    [""],
                    _quantity,
                    existingMarketplaceItem.item.batchId,
                    existingMarketplaceItem.product.category,
                    existingMarketplaceItem.inventory.pricePerUnit,
                    InventoryStatus.UNPUBLISHED,
                    existingMarketplaceItem.product.subCategory,
                    existingMarketplaceItem.item.inventoryType,
                    existingMarketplaceItem.product.name,
                    existingMarketplaceItem.product.description,
                    existingMarketplaceItem.product.manufacturer,
                    existingMarketplaceItem.product.unitOfMeasurement,
                    existingMarketplaceItem.product.userUniqueProductCode,
                    existingMarketplaceItem.product.leastSellableUnit,
                    existingMarketplaceItem.product.imageKey,
                    existingMarketplaceItem.product.isActive,
                    existingMarketplaceItem.product.isDeleted,
                    existingMarketplaceItem.product.isInventoryAvailable
                );
            return (status, inventoryAddress);
        } else {
            updateInventory(_itemsAddress[i] ,_item.inventory.pricePerUnit, ,_item.inventory.status ,_scheme);
            for (uint i = 0; i < _itemsAddress.length; i++) {
                MarketplaceItem _item = MarketplaceItem(_itemsAddress[i]);
                _item.transferOwnership(
                    _newOwner,
                    address(_item.product.productId),
                    address(_item.inventory.inventoryId)
                );
                return (status, inventoryAddress);//CHANGE
            }
            
        }

        return (RestStatus.BAD_REQUEST, address(0));
    }

    //DONE
    function getOrganization(address _owner) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(_owner);
        string ownerOrganization = ownerCert["organization"];

        return ownerOrganization;
    }

    //DONE
    function checkForProduct(
        uint _uniqueProductCode,
        address _owner
    ) public returns (address) {
        string _organization = getOrganization(_owner);

        if (orgToUPCToProduct[_organization][_uniqueProductCode] != address(0)) 
        {
            return orgToUPCToProduct[_organization][_uniqueProductCode];
        }
        return address(0);
    }
}
