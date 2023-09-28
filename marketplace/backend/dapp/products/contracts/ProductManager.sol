import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Product.sol";
import "./Inventory.sol";
import "/dapp/products/contracts/UnitOfMeasurement.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ProductManager is UnitOfMeasurement, InventoryStatus, RestStatus {
    // constructor() public {}
    mapping(string => mapping(uint => address)) orgToUPCToProduct;
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
        InventoryStatus _status,
        uint _createdDate,
        string[] _serialNumbers,
        uint _taxPercentageAmount,
        uint _taxDollarAmount
    ) returns (uint256, address) {
        if (_serialNumbers.length == 0) {
            Product_3 product = Product_3(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _batchId,
                    _status,
                    _createdDate,
                    tx.origin,
                    _taxPercentageAmount,
                    _taxDollarAmount
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
                    _status,
                    _createdDate,
                    tx.origin,
                    _taxPercentageAmount,
                    _taxDollarAmount
                );
        }
    }

    function updateInventory(
        address _productAddress,
        address _inventory,
        int _pricePerUnit,
        int _quantity,
        InventoryStatus _status,
        uint _scheme
    ) returns (uint256) {
        Product_3 product = Product_3(_productAddress);
        return
            product.updateInventory(
                _inventory,
                _pricePerUnit,
                _status,
                _quantity,
                _scheme
            );
    }

    function updateInventoriesQuantities(
        address[] _inventories,
        int[] _quantities,
        bool _isReduce
    ) returns (uint256) {
        for (uint i = 0; i < _inventories.length; i++) {
            Inventory_2 inventory = Inventory_2(_inventories[i]);

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

    function getOrganization(address _owner) public returns (string) {
        mapping(string => string) ownerCert = getUserCert(_owner);
        string ownerOrganization = ownerCert["organization"];

        return ownerOrganization;
    }

    function checkForProduct(
        address _productAddress,
        uint _uniqueProductCode,
        address _owner
    ) public returns (address) {
        string _organization = getOrganization(_owner);

        if (
            orgToUPCToProduct[_organization][_uniqueProductCode] !=
            address(0) &&
            orgToUPCToProduct[_organization][_uniqueProductCode] ==
            address(_productAddress)
        ) {
            return orgToUPCToProduct[_organization][_uniqueProductCode];
        }
        return address(0);
    }
}
