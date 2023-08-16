import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Product.sol";
import "./Inventory.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ProductManager is InventoryStatus, RestStatus {
    // constructor() public {}
    mapping(address => mapping(string => bool))
        private uniqueSerialNumberByProductAddress;
    mapping(string => mapping(uint => address)) orgToUPCToProduct;

    function addProduct(
        string _name,
        string _description,
        uint _uniqueProductCode,
        string _imageKey,
        bool _isActive,
        string _category,
        uint _createdDate
    ) returns (uint256, address) {
        Product_4 product = new Product_4(
            _name,
            _description,
            _uniqueProductCode,
            _imageKey,
            _isActive,
            _category,
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
        uint _uniqueProductCode,
        string _imageKey,
        bool _isActive,
        string _category,
        uint _createdDate,
        address _newOwner
    ) returns (address) {
        Product_4 product = new Product_4(
            _name,
            _description,
            _uniqueProductCode,
            _imageKey,
            _isActive,
            _category,
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
        uint _scheme
    ) returns (uint256) {
        Product_4 product = Product_4(_productAddress);
        return product.update(_description, _imageKey, _isActive, _scheme);
    }
    function deleteProduct(address _productAddress) returns (uint256, string) {
        Product_4 product = Product_4(_productAddress);
        return product.deleteProduct();
    }

    function addInventory(
        address _productAddress,
        int _quantity,
        int _pricePerUnit,
        uint _vintage,
        InventoryStatus _status,
        uint _createdDate,
        string[] _serialNumbers
    ) returns (uint256, address) {
        if (_serialNumbers.length == 0) {
            Product_4 product = Product_4(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _vintage,
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

            Product_4 product = Product_4(_productAddress);
            return
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _vintage,
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
        Product_4 product = Product_4(_productAddress);
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
            Inventory_3 inventory = Inventory_3(_inventories[i]);

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
        uint _uniqueProductCode,
        address _owner
    ) public returns (address) {
        string _organization = getOrganization(_owner);

        if (
            orgToUPCToProduct[_organization][_uniqueProductCode] != address(0)
        ) {
            return orgToUPCToProduct[_organization][_uniqueProductCode];
        }
        return address(0);
    }
}
