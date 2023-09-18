import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/Item.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/products/contracts/Inventory.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/ProductManager.sol";

/// @title A representation of ItemManager to manage items
contract ItemManager is ItemStatus, InventoryStatus {
    // check if the serial number is mapping(serialNumber => UPC ) uniqueSerialNumberByUPC;
    mapping(string => uint) private uniqueSerialNumberByUPC;
    mapping(address => address) private itemProductIdMapping;
    mapping(address => address) private itemInventoryIdMapping;

    struct ItemObject {
        string serialNumber;
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

        for (uint256 i = 0; i < _itemObject.length; i++) {
            Item_4 itemAddr = new Item_4(
                _productId,
                _uniqueProductCode,
                _inventoryId,
                _itemObject[i].serialNumber,
                _status,
                _comment,
                _createdDate
            );
        }

        return (RestStatus.OK, itemAddresses, repeatedSerialNumbers);
    }

    function updateItem(
        address[] _itemsAddress,
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) public returns (uint) {
        for (uint256 i = 0; i < _itemsAddress.length; i++) {
            Item_4 item = Item_4(_itemsAddress[i]);
            item.update(_status, _comment, _scheme);
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
            Item_4 item = Item_4(_itemAddress);
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
        int _newQuantity,
        string _serialNumber
    ) public returns (uint, address, address) {
        Product_3 product;
        Inventory_12 inventory;
        Item_4 item = Item_4(_itemsAddress[0]);

        // get Dapp contract from dapp chain
        Dapp dapp = Dapp(address(_dappAddress));
        ProductManager productManager = dapp.productManager();

        Product_3 oldProduct = Product_3(item.productId());
        address productAddress = productManager.checkForProduct(
            address(oldProduct),
            oldProduct.uniqueProductCode(),
            _newOwner
        );

        product = (productAddress == address(0))
            ? new Product_3(
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
            : Product_3(productAddress);

        Inventory_12 oldInventory = Inventory_12(item.inventoryId());

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
            Item_4 itemAddr = new Item_4(
                address(product),
                oldProduct.uniqueProductCode(),
                address(inventory),
                _serialNumber,
                ItemStatus.UNPUBLISHED,
                "",
                block.timestamp
            );
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
                Item_4 _item = Item_4(_itemsAddress[i]);
                _item.transferOwnership(
                    _newOwner,
                    address(product),
                    address(inventory)
                );
            }
        }

        return (RestStatus.OK, address(product), address(inventory));
    }

}
