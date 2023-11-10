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
        uint itemNumber;
        string serialNumber;
        string[] rawMaterialProductName;
        string[] rawMaterialSerialNumber;
        string[] rawMaterialProductId;
    }

    event ItemTransfers(
        address indexed oldOwner,
        string oldOwnerOrganization,
        string oldOwnerOrganizationalUnit,
        string oldOwnerCommonName,
        address indexed newOwner,
        string newOwnerOrganization,
        string newOwnerOrganizationalUnit,
        string newOwnerCommonName,
        address indexed inventoryId,
        string productName,
        uint transferNumber,
        uint quantity,
        uint transferDate
    );

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
                Item_3 itemAddr = new Item_3(
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
                Item_3 itemAddr = new Item_3(
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

    function updateItem(
        address[] _itemsAddress,
        ItemStatus _status,
        string _comment,
        uint _scheme
    ) public returns (uint) {
        for (uint256 i = 0; i < _itemsAddress.length; i++) {
            Item_3 item = Item_3(_itemsAddress[i]);
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
            Item_3 item = Item_3(_itemAddress);
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
        uint _itemNumber,
        bool _isUserTransfer,
        uint _transferNumber
    ) public returns (uint, address, address) {
        Product_3 product;
        Inventory inventory;
        Item_3 item = Item_3(_itemsAddress[0]);


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
        
        string oldOwnerOrganization = oldInventory.ownerOrganization();
        string oldOwnerCommonName = oldInventory.ownerCommonName();
        string oldOwnerOrganizationalUnit = oldInventory.ownerOrganizationalUnit();


        // get new owner organization
        mapping(string => string) ownerCert = getUserCert(_newOwner);
        string newOwnerOrganization = ownerCert["organization"];
        string newOwnerCommonName = ownerCert["commonName"];
        string newOwnerOrganizationalUnit = ownerCert["organizationalUnit"];

        bool hasInventoryType = true;
        try {
            oldInventory.inventoryType();
        } catch UnknownFunction {
            hasInventoryType = false;
        }
        if (hasInventoryType && oldInventory.inventoryType() == "Batch") {
            (uint status, address inventory) = product.addInventory(
                _newQuantity,
                oldInventory.pricePerUnit(),
                oldInventory.batchId(),
                InventoryStatus.UNPUBLISHED,
                block.timestamp,
                _newOwner,
                "Batch"
            );
            Item_3 batch_item = new Item_3(
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
            address itemContractAddress = address(batch_item);
            itemProductIdMapping[itemContractAddress] = address(product);
            itemInventoryIdMapping[itemContractAddress] = address(inventory);

            item.generateOwnershipHistory(
                oldInventory.ownerOrganization(),
                batch_item.ownerOrganization(),
                block.timestamp,
                address(batch_item)
            );
        } else {
            (uint status, address inventory) = product.addInventory(
                _itemsAddress.length,
                oldInventory.pricePerUnit(),
                oldInventory.batchId(),
                InventoryStatus.UNPUBLISHED,
                block.timestamp,
                _newOwner,
                "Individual"
            );
            for (uint i = 0; i < _itemsAddress.length; i++) {
                Item_3 _item = Item_3(_itemsAddress[i]);
                _item.transferOwnership(
                    _newOwner,
                    address(product),
                    address(inventory)
                );
            }
        }

        if (_isUserTransfer == true) {
            emit ItemTransfers(
                tx.origin,
                oldOwnerOrganization,
                oldOwnerOrganizationalUnit,
                oldOwnerCommonName,
                _newOwner,
                newOwnerOrganization,
                newOwnerOrganizationalUnit,
                newOwnerCommonName,
                address(inventory),
                product.name(),
                _transferNumber,
                _newQuantity,
                block.timestamp
            );
        }

        return (RestStatus.OK, address(product), address(inventory));
    }
}