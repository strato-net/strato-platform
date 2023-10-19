import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/MarketplaceItem.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/items/contracts/InventoryStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/items/contracts/UnitOfMeasurement.sol";

/// @title A representation of ItemManager to manage items
contract MarketplaceItemManager is ItemStatus, InventoryStatus, UnitOfMeasurement, RestStatus  {
    // check if the serial number is mapping(serialNumber => UPC ) uniqueSerialNumberByUPC;
    mapping(string => uint) private uniqueSerialNumberByUPC;
    mapping(address => address) private itemProductIdMapping;
    mapping(address => address) private itemInventoryIdMapping;
    mapping(uint256 => address) private marketplaceItemProducts;
    
    mapping(string => mapping(uint => address)) record orgToUPCToProduct;
    mapping(address => mapping(string => bool));
    private uniqueSerialNumberByProductAddress;

    struct ItemObject {
        uint itemNumber;
        string serialNumber;
        string[] rawMaterialProductName;
        string[] rawMaterialSerialNumber;
        string[] rawMaterialProductId;
    }

    function addItem(
        address _productId,
        address _inventoryId,
        uint _uniqueProductCode,
        ItemObject[] _itemObject,
        ItemStatus _status,
        string _comment,
        uint _createdDate
    ) public returns (uint, string, string) {
        string itemAddresses = "";
        string repeatedSerialNumbers = "";

        if (_itemObject[0].serialNumber == "") {
            for (uint256 i = 0; i < _itemObject.length; i++) {
                MarketplaceItem itemAddr = new MarketplaceItem(
                    _productId,
                    _uniqueProductCode,
                    _inventoryId,
                    _itemObject[i].serialNumber,
                    _status,
                    _comment,
                    _itemObject[i].rawMaterialProductName,
                    _itemObject[i].rawMaterialSerialNumber,
                    _itemObject[i].rawMaterialProductId,
                    _itemObject[i].itemNumber,
                    _createdDate,
                    tx.origin
                );

                address itemContractAddress = address(itemAddr);
                itemAddr.generateOwnershipHistory(
                    "",
                    itemAddr.ownerOrganization(),
                    _createdDate,
                    itemContractAddress
                );

                uniqueSerialNumberByUPC[
                    _itemObject[0].serialNumber
                ] = _uniqueProductCode;
                itemProductIdMapping[itemContractAddress] = _productId;
                itemInventoryIdMapping[itemContractAddress] = _inventoryId;
                itemAddresses += string(address(itemAddr)) + ",";
            }
            return (RestStatus.OK, itemAddresses, repeatedSerialNumbers);
        }

        for (uint256 i = 0; i < _itemObject.length; i++) {
            string currentSerialNumber = _itemObject[i].serialNumber;
            uint exisitngUPC = uniqueSerialNumberByUPC[currentSerialNumber];

            if (exisitngUPC == _uniqueProductCode) {
                repeatedSerialNumbers += currentSerialNumber + ",";
            } else {
                MarketplaceItem itemAddr = new MarketplaceItem(
                    _productId,
                    _uniqueProductCode,
                    _inventoryId,
                    currentSerialNumber,
                    _status,
                    _comment,
                    _itemObject[i].rawMaterialProductName,
                    _itemObject[i].rawMaterialSerialNumber,
                    _itemObject[i].rawMaterialProductId,
                    _itemObject[i].itemNumber,
                    _createdDate,
                    tx.origin
                );

                address itemContractAddress = address(itemAddr);
                itemAddr.generateOwnershipHistory(
                    "",
                    itemAddr.ownerOrganization(),
                    _createdDate,
                    itemContractAddress
                );

                uniqueSerialNumberByUPC[
                    currentSerialNumber
                ] = _uniqueProductCode;
                itemProductIdMapping[itemContractAddress] = _productId;
                itemInventoryIdMapping[itemContractAddress] = _inventoryId;
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
        Product_3 product;
        Inventory inventory;
        MarketplaceItem item = MarketplaceItem(_itemsAddress[0]);

        // get Dapp contract from dapp chain
        Dapp dapp = Dapp(address(_dappAddress));
        ProductManager productManager = dapp.productManager();

        Product_3 oldProduct = Product_3(item.productId());
        address productAddress = productManager.checkForProduct(
            oldProduct.uniqueProductCode(),
            _newOwner
        );

        if (productAddress == address(0)) {
                    address addr = productManager.addProductForBuyer(
                        oldProduct.name(),
                        oldProduct.description(),
                        oldProduct.manufacturer(),
                        oldProduct.unitOfMeasurement(),
                        oldProduct.userUniqueProductCode(),
                        oldProduct.uniqueProductCode(),
                        oldProduct.leastSellableUnit(),
                        oldProduct.imageKey(),
                        oldProduct.isActive(),
                        oldProduct.category(),
                        oldProduct.subCategory(),
                        block.timestamp,
                        _newOwner
                    );
                    product = Product_3(addr);
                } else {
                    product = Product_3(productAddress);
                }

        Inventory oldInventory = Inventory(item.inventoryId());

        if (oldInventory.inventoryType() == "Batch") {
            (uint status, address inventory) = product.addInventory(
                _newQuantity,
                oldInventory.pricePerUnit(),
                oldInventory.batchId(),
                oldInventory.inventoryType(),
                InventoryStatus.UNPUBLISHED,
                block.timestamp,
                _newOwner
            );
            MarketplaceItem itemAddr = new MarketplaceItem(
                address(product),
                oldProduct.uniqueProductCode(),
                address(inventory),
                "",
                ItemStatus.UNPUBLISHED,
                "",
                [""],
                [""],
                [""],
                _itemNumber,
                block.timestamp,
                _newOwner
            );
            address itemContractAddress = address(itemAddr);
            itemProductIdMapping[itemContractAddress] = address(product);
            itemInventoryIdMapping[itemContractAddress] = address(inventory);
        } else {
            (uint status, address inventory) = product.addInventory(
                _itemsAddress.length,
                oldInventory.pricePerUnit(),
                oldInventory.batchId(),
                oldInventory.inventoryType(),
                InventoryStatus.UNPUBLISHED,
                block.timestamp,
                _newOwner
            );
            for (uint i = 0; i < _itemsAddress.length; i++) {
                MarketplaceItem _item = MarketplaceItem(_itemsAddress[i]);
                _item.transferOwnership(
                    _newOwner,
                    address(product),
                    address(inventory)
                );
            }
        }

        return (RestStatus.OK, address(product), address(inventory));
    }


    function addProduct(
        string _name,
        string _description,
        string _manufacturer,
        UnitOfMeasurement _unitOfMeasurement,
        string _userUniqueProductCode,
        uint _uniqueProductCode,
        int _leastSellableUnit,
        string _imageKey,
        bool _isActive,
        string _category,
        string _subCategory,
        uint _createdDate
    ) returns (uint256, address) {
        Product_3 product = new Product_3(
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
            tx.origin
        );

        string _organization = getOrganization(tx.origin);
        orgToUPCToProduct[_organization][_uniqueProductCode] = address(product);

        return (RestStatus.OK, address(product));
    }

    function addProductForBuyer(
        string _name,
        string _description,
        string _manufacturer,
        UnitOfMeasurement _unitOfMeasurement,
        string _userUniqueProductCode,
        uint _uniqueProductCode,
        int _leastSellableUnit,
        string _imageKey,
        bool _isActive,
        string _category,
        string _subCategory,
        uint _createdDate,
        address _newOwner
    ) returns (address) {
        Product_3 product = new Product_3(
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
            _newOwner
        );

        string _organization = getOrganization(_newOwner);
        orgToUPCToProduct[_organization][_uniqueProductCode] = address(product);

        return (address(product));
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
        return mi.deleteProduct();
    }

    function addInventory(
        address _productAddress,
        int _quantity,
        int _pricePerUnit,
        string _batchId,
        string _inventoryType,
        InventoryStatus _status,
        uint _createdDate,
        string[] _serialNumbers
    ) returns (uint256, address) {
        if (_serialNumbers.length == 0) {
            Product_3 product = Product_3(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _batchId,
                    _inventoryType,
                    _status,
                    _createdDate,
                    tx.origin
                );
        } else {
            for (uint256 i = 0; i < _serialNumbers.length; i++) {
                if (
                    uniqueSerialNumberByProductAddress[_productAddress][
                        _serialNumbers[i]
                    ]
                ) {
                    return (RestStatus.CONFLICT, address(0));
                }
            }

            for (uint256 j = 0; j < _serialNumbers.length; j++) {
                uniqueSerialNumberByProductAddress[_productAddress][
                    _serialNumbers[j]
                ] = true;
            }

            Product_3 product = Product_3(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _batchId,
                    _inventoryType,
                    _status,
                    _createdDate,
                    tx.origin
                );
        }
    }

    //DONE
    function updateInventory(
        address _marketplaceItemAddress,
        address _inventory,
        int _pricePerUnit,
        InventoryStatus _status,
        uint _scheme
    ) returns (uint256) {
        MarketlplaceItem mi = MarketlplaceItem(_marketplaceItemAddress);
        return
            mi.updateInventory(
                _inventory,
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
        address[] _itemsAddress
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
            //Not sure why this is here maybe addItem?
            // Item_3 itemAddr = new Item_3(
            //     address(product),
            //     product.uniqueProductCode(),
            //     address(inventoryAddress),
            //     "",
            //     ItemStatus.PUBLISHED,
            //     "",
            //     [""],
            //     [""],
            //     [""],
            //     _itemNumber,
            //     block.timestamp,
            //     tx.origin
            // );
            return (status, inventoryAddress);
        } else {
            (uint256 status, address inventoryAddress) = existingMarketplaceItem.addInventory(
                _quantity,
                _price,
                existingMarketplaceItem.inventory.batchId(),
                existingMarketplaceItem.inventory.inventoryType(),
                InventoryStatus.PUBLISHED,
                block.timestamp,
                tx.origin
            );
            for (int i = 0; i < _quantity; i++) {
                MarketplaceItem _item = MarketplaceItem(_itemsAddress[i]);
                _item.update(ItemStatus.PUBLISHED, _item.comment(), 1);
                _item.transferOwnership(
                    tx.origin,
                    address(existingMarketplaceItem),
                    address(inventoryAddress)
                );
            }
            return (status, inventoryAddress);
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
