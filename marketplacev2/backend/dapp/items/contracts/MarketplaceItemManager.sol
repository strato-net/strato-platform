import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/MarketplaceItem.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/items/contracts/UnitOfMeasurement.sol";

contract MarketplaceItemManager is ItemStatus, 
                                   InventoryStatus, 
                                   MarketplaceItem,
                                   RestStatus,
                                   UnitOfMeasurement
                                    {
    // check if the serial number is mapping(serialNumber => UPC ) uniqueSerialNumberByUPC;
    mapping(string => uint) private uniqueSerialNumberByUPC;
    mapping(address => address) private marketplaceItemProductIdMapping;
    mapping(address => address) private marketplaceItemInventoryIdMapping;
    mapping(string => mapping(uint => address)) record orgToUPCToProduct;

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
}
