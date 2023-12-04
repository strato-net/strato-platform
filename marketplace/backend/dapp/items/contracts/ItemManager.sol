import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/Item.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/ProductManager.sol";

/// @title A representation of Mem_ItemManager to manage items
contract Mem_ItemManager is ItemStatus, InventoryStatus {
    // check if the serial number is mapping(serialNumber => UPC ) uniqueSerialNumberByUPC;
    mapping(string => uint) private uniqueSerialNumberByUPC;
    mapping(address => address) private itemProductIdMapping;
    mapping(address => address) private itemInventoryIdMapping;

    struct ownershipResponseSchema {
        address productId;
        address inventoryId;
    }

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
                Mem_Item_3 itemAddr = new Mem_Item_3(
                    _productId,
                    _uniqueProductCode,
                    _inventoryId,
                    "",
                    _status,
                    _comment,
                    _itemObject[i].rawMaterialProductName,
                    _itemObject[i].rawMaterialSerialNumber,
                    _itemObject[i].rawMaterialProductId,
                    _itemObject[i].itemNumber,
                    _createdDate
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
                Mem_Item_3 itemAddr = new Mem_Item_3(
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
                    _createdDate
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

    function updateItem(
        address[] _itemsAddress,
        ItemStatus _status,
        string _comment,
        uint _expiryDate,
        uint _scheme
    ) public returns (uint) {
        for (uint256 i = 0; i < _itemsAddress.length; i++) {
            Mem_Item_3 item = Mem_Item_3(_itemsAddress[i]);
            item.update(_status, _comment, _expiryDate, _scheme);
        }
        return (RestStatus.OK);
    }

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
            Mem_Item_3 item = Mem_Item_3(_itemAddress);
            string _itemSerialNumber = item.serialNumber();

            Event_1 eventAddr = new Event_1(
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

    function certifyEvent(
        address[] _eventAddress,
        string _certifierComment,
        uint _certifiedDate,
        uint _scheme
    ) public returns (uint, string) {
        for (uint256 i = 0; i < _eventAddress.length; i++) {
            Event_1 eventAddr = Event_1(_eventAddress[i]);
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
        uint _quantity
    ) public returns (uint, string memory, string memory) {
        Dapp dapp = Dapp(address(_dappAddress));
        Mem_ProductManager productManager = dapp.productManager();
        (string productId, string inventoryId) = getProductAndInventory(
            productManager,
            _itemsAddress,
            _newOwner
        );

        return (RestStatus.OK, productId, inventoryId);
    }

    function getProductAndInventory(
        Mem_ProductManager _productManager,
        address[] _itemAddress,
        address _newOwner
    ) public returns (string memory, string memory) {
        string memory productIds = "";
        string memory inventoryIds = "";
        for (uint i = 0; i < _itemAddress.length; i++) {
            Mem_Item_3 item = Mem_Item_3(_itemAddress[i]);
            Mem_Product_3 product;
            Mem_Inventory_2 inventory;

            Mem_Product_3 oldProduct = Mem_Product_3(item.productId());
            address productAddress = _productManager.checkForProduct(
                address(oldProduct),
                oldProduct.uniqueProductCode(),
                _newOwner
            );

            product = (productAddress == address(0))
                ? new Mem_Product_3(
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
                )
                : Mem_Product_3(productAddress);

            Mem_Inventory_2 oldInventory = Mem_Inventory_2(item.inventoryId());

            (uint status, address inventory) = product.addInventory(
                1,
                oldInventory.pricePerUnit(),
                oldInventory.batchId(),
                InventoryStatus.UNPUBLISHED,
                block.timestamp,
                _newOwner,
                oldInventory.taxPercentageAmount(),
                oldInventory.taxDollarAmount()
            );

            Mem_Item_3 _item = Mem_Item_3(_itemAddress[i]);
            _item.transferOwnership(
                _newOwner,
                address(product),
                address(inventory)
            );

             if (i > 0) {
                productIds =
                    string(productIds) +
                    "," +
                    string(address(product));
                inventoryIds =
                    string(inventoryIds) +
                    "," +
                    string(address(inventory));
            } else {
                productIds = string(address(product));
                inventoryIds = string(address(inventory));
            }

        }

        return (productIds, inventoryIds);
    }
}
