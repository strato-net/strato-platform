import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Product.sol";
import "./Inventory.sol";
import "./Carbon.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of ProductManager to manage product and inventory
contract ProductManager is InventoryStatus, RestStatus {
    // constructor() public {}
    mapping(address => mapping(string => bool))
        private uniqueSerialNumberByProductAddress;

    mapping(string => mapping(uint => address)) record orgToUPCToProduct;

    /////////////////////// carbon specific ///////////////////////////////////////////////////////////////////////////////////
    mapping(string => mapping(address => mapping(uint => mapping(int => address)))) record orgxProductxVintagexPricexInventory;
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

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

    function addCarbon(
        address _productId,
        string _projectType,
        string _methodology,
        string _projectCountry,
        string _projectCategory,
        string _projectDeveloper,
        string _dMRV,
        string _registry,
        string _creditType,
        string _sdg,
        string _validator,
        string _eligibility,
        string _permanenceType,
        string _reductionType,
        string _unit,
        string _currency,
        int _divisibility
    ) returns (uint256, address) {
        Carbon carbon = new Carbon(
            _productId,
            _projectType,
            _methodology,
            _projectCountry,
            _projectCategory,
            _projectDeveloper,
            _dMRV,
            _registry,
            _creditType,
            _sdg,
            _validator,
            _eligibility,
            _permanenceType,
            _reductionType,
            _unit,
            _currency,
            _divisibility
        );

        return (RestStatus.OK, address(carbon));
    }

    function addInventory(
        address _productAddress,
        int _availableQuantity,
        int _pricePerUnit,
        uint _vintage,
        InventoryStatus _status,
        uint _createdDate,
        string _batchSerializationNumber,
        string[] _serialNumbers
    ) returns (uint256, address) {
        if (_serialNumbers.length == 0) {
            Product_4 product = Product_4(_productAddress);
            address isUnique = checkForInventory(
                _vintage,
                _productAddress,
                _pricePerUnit,
                tx.origin
            );
            if (isUnique != address(0)) {
                Inventory_7 inventory = Inventory_7(isUnique);
                inventory.updateQuantity(
                    inventory.availableQuantity() + _availableQuantity
                );
                return (RestStatus.OK, isUnique);
            }
            (uint256 status, address inventoryAddress) = product.addInventory(
                _availableQuantity,
                _pricePerUnit,
                _vintage,
                _status,
                _createdDate,
                _batchSerializationNumber,
                tx.origin
            );
            string _organization = getOrganization(tx.origin);
            orgxProductxVintagexPricexInventory[_organization][_productAddress][
                _vintage
            ][_pricePerUnit] = address(inventoryAddress);

            return (status, inventoryAddress);
        }
        return (RestStatus.FORBIDDEN, address(0));
    }

    function addInventoryForBuyer(
        address _productAddress,
        int _availableQuantity,
        int _pricePerUnit,
        uint _vintage,
        InventoryStatus _status,
        uint _createdDate,
        string _batchSerializationNumber,
        address _newOwner
    ) returns (uint256, address) {
        string _organization = getOrganization(_newOwner);

        Product_4 product = Product_4(_productAddress);

        (uint256 status, address inventoryAddress) = product.addInventory(
            _availableQuantity,
            _pricePerUnit,
            _vintage,
            _status,
            _createdDate,
            _batchSerializationNumber,
            _newOwner
        );

        orgxProductxVintagexPricexInventory[_organization][_productAddress][
            _vintage
        ][_pricePerUnit] = inventoryAddress;

        return (status, inventoryAddress);
    }

    function resellInventory(
        address _existingInventory,
        int _quantity,
        int _price
    ) returns (uint256, address) {
        Inventory_7 existingInventory = Inventory_7(_existingInventory);
        if (
            _quantity > existingInventory.availableQuantity() || _quantity <= 0
        ) {
            return (RestStatus.BAD_REQUEST, address(0));
        }
        Product_4 product = Product_4(existingInventory.productId());
        uint256 isUpdated = existingInventory.updateQuantityForResell(
            _quantity
        );
        (uint256 status, address inventoryAddress) = product.addInventory(
            _quantity,
            _price,
            existingInventory.vintage(),
            InventoryStatus.PUBLISHED,
            block.timestamp,
            existingInventory.batchSerializationNumber(),
            tx.origin
        );
        return (status, inventoryAddress);
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
            Inventory_7 inventory = Inventory_7(_inventories[i]);

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

    function checkForInventory(
        uint _vintage,
        address _product,
        int _pricePerUnit,
        address _owner
    ) public returns (address) {
        string _organization = getOrganization(_owner);

        if (
            (_vintage != 0) &&
            (orgxProductxVintagexPricexInventory[_organization][_product][
                _vintage
            ][_pricePerUnit] != address(0))
        ) {
            return
                orgxProductxVintagexPricexInventory[_organization][_product][
                    _vintage
                ][_pricePerUnit];
        }
        return address(0);
    }

    function sellItems(
        address _productId,
        address _inventoryId,
        address _newOwner,
        int _newQuantity
    ) public returns (uint, address, address) {
        Product_4 product;
        Inventory_7 inventory;

        Product_4 oldProduct = Product_4(_productId);
        address productAddress = checkForProduct(
            oldProduct.uniqueProductCode(),
            _newOwner
        );

        if (productAddress == address(0)) {
            address addr = addProductForBuyer(
                oldProduct.name(),
                oldProduct.description(),
                oldProduct.uniqueProductCode(),
                oldProduct.imageKey(),
                oldProduct.isActive(),
                oldProduct.category(),
                block.timestamp,
                _newOwner
            );
            product = Product_4(addr);
        } else {
            product = Product_4(productAddress);
        }

        Inventory_7 oldInventory = Inventory_7(_inventoryId);

        address uniqueInventoryAddress = checkForInventory(
            oldInventory.vintage(),
            productAddress,
            oldInventory.pricePerUnit(),
            _newOwner
        );

        //if no inventory is created before && vintage is invalid   );
        if (uniqueInventoryAddress == address(0)) {
            (uint256 status, address inventoryAddr) = addInventoryForBuyer(
                address(product),
                _newQuantity,
                oldInventory.pricePerUnit(),
                oldInventory.vintage(),
                InventoryStatus.UNPUBLISHED,
                block.timestamp,
                oldInventory.batchSerializationNumber(),
                _newOwner
            );
            inventory = Inventory_7(inventoryAddr);
        } else {
            //inventory retreived
            Inventory_7 inventoryToBeAdded = Inventory_7(
                uniqueInventoryAddress
            );
            int availableQuantity = inventoryToBeAdded.availableQuantity();
            //quantity updated
            uint256 status = inventoryToBeAdded.updateQuantity(
                availableQuantity + _newQuantity
            );
            inventory = inventoryToBeAdded;
        }

        if (
            address(product) == address(0) || address(inventory) == address(0)
        ) {
            return (
                RestStatus.BAD_REQUEST,
                address(product),
                address(inventory)
            );
        }

        return (RestStatus.OK, address(product), address(inventory));
    }

    function retireCredits(
        address _inventoryId,
        string _retiredBy,
        string _retiredOnBehalfOf,
        int _quantity,
        string _purpose
    ) returns (uint256, address) {
        Inventory_7 inventory = Inventory_7(_inventoryId);
        if (_quantity > inventory.availableQuantity()) {
            return (RestStatus.BAD_REQUEST, address(0));
        }

        uint256 currentTimestamp = block.timestamp;
        uint256 currentYear = (currentTimestamp / 31536000) + 1970;
        if (inventory.vintage() > currentYear) {
            return (RestStatus.BAD_REQUEST, address(0));
        }

        return
            inventory.retireCredits(
                _inventoryId,
                _retiredBy,
                _retiredOnBehalfOf,
                _quantity,
                _purpose
            );
    }
}
