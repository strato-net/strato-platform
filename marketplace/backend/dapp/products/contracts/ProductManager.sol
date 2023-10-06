import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Product.sol";
import "./Inventory.sol";
import "/dapp/items/contracts/Item.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/UnitOfMeasurement.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ProductManager is
    UnitOfMeasurement,
    InventoryStatus,
    ItemStatus,
    RestStatus
{
    // constructor() public {}
    mapping(string => mapping(uint => address)) record orgToUPCToProduct;
    mapping(address => mapping(string => bool))
        private uniqueSerialNumberByProductAddress;

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
        address _productAddress,
        string _description,
        string _imageKey,
        bool _isActive,
        string _userUniqueProductCode,
        uint _scheme
    ) returns (uint256) {
        Product_3 product = Product_3(_productAddress);
        return
            product.update(
                _description,
                _imageKey,
                _isActive,
                _userUniqueProductCode,
                _scheme
            );
    }

    function deleteProduct(address _productAddress) returns (uint256, string) {
        Product_3 product = Product_3(_productAddress);
        return product.deleteProduct();
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

    function updateInventory(
        address _productAddress,
        address _inventory,
        int _pricePerUnit,
        InventoryStatus _status,
        uint _scheme
    ) returns (uint256) {
        Product_3 product = Product_3(_productAddress);
        return
            product.updateInventory(
                _inventory,
                _pricePerUnit,
                _status,
                _scheme
            );
    }

    function updateInventoriesQuantities(
        address[] _inventories,
        int[] _quantities,
        bool _isReduce
    ) returns (uint256) {
        for (uint i = 0; i < _inventories.length; i++) {
            Inventory inventory = Inventory(_inventories[i]);

            if (_isReduce) {
                if (_quantities[i] > inventory.availableQuantity()) {
                    return RestStatus.BAD_REQUEST;
                }
                int quantityToDeduct = inventory.availableQuantity() -
                    _quantities[i];
                inventory.updateQuantity(quantityToDeduct);
            } else {
                int quantityToAdd = inventory.availableQuantity() +
                    _quantities[i];

                if (quantityToAdd > inventory.quantity()) {
                    return RestStatus.BAD_REQUEST;
                }
                inventory.updateQuantity(quantityToAdd);
            }
        }
        return RestStatus.OK;
    }

    function resellInventory(
        address _existingInventory,
        int _quantity,
        int _price,
        uint _itemNumber,
        address[] _itemsAddress
    ) returns (uint256, address) {
        Inventory existingInventory = Inventory(_existingInventory);
        if (
            _quantity > existingInventory.availableQuantity() || _quantity <= 0
        ) {
            return (RestStatus.BAD_REQUEST, address(0));
        }
        Product_3 product = Product_3(existingInventory.productId());
        uint256 isUpdated = existingInventory.updateQuantity(
            existingInventory.availableQuantity() - _quantity
        );
        if (existingInventory.inventoryType() == "Batch") {
            (uint256 status, address inventoryAddress) = product.addInventory(
                _quantity,
                _price,
                existingInventory.batchId(),
                existingInventory.inventoryType(),
                InventoryStatus.PUBLISHED,
                block.timestamp,
                tx.origin
            );
            Item_3 itemAddr = new Item_3(
                address(product),
                product.uniqueProductCode(),
                address(inventoryAddress),
                "",
                ItemStatus.PUBLISHED,
                "",
                [""],
                [""],
                [""],
                _itemNumber,
                block.timestamp,
                tx.origin
            );
            return (status, inventoryAddress);
        } else {
            (uint256 status, address inventoryAddress) = product.addInventory(
                _quantity,
                _price,
                existingInventory.batchId(),
                existingInventory.inventoryType(),
                InventoryStatus.PUBLISHED,
                block.timestamp,
                tx.origin
            );
            for (int i = 0; i < _quantity; i++) {
                Item_3 _item = Item_3(_itemsAddress[i]);
                _item.transferOwnership(
                    tx.origin,
                    address(product),
                    address(inventoryAddress)
                );
            }
            return (status, inventoryAddress);
        }

        return (RestStatus.BAD_REQUEST, address(0));
    }

    function getOrganization(address _owner) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(_owner);
        string ownerOrganization = ownerCert["organization"];

        return ownerOrganization;
    }

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
