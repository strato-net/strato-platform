import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "./Product.sol";
import "./Inventory.sol";
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
            address isUnique = checkForInventory(_vintage,_productAddress,_pricePerUnit,tx.origin);
            if(isUnique!=address(0))
            {
                 Inventory_3 inventory = Inventory_3(isUnique);
                 inventory.updateQuantityForVintages(inventory.availableQuantity()+_quantity);
                 return (RestStatus.OK, isUnique);
            }
            (uint256 status, address inventoryAddress) =
                product.addInventory(
                    _quantity,
                    _pricePerUnit,
                    _vintage,
                    _status,
                    _createdDate,
                    tx.origin
                );
        string _organization = getOrganization(tx.origin);
        orgxProductxVintagexPricexInventory[_organization][_productAddress][_vintage][_pricePerUnit] = address(inventoryAddress);
        
        return (status, inventoryAddress);
        }
        return (RestStatus.FORBIDDEN,address(0));
    }


    function addInventoryForBuyer(
                                address _productAddress,
                                int _quantity,
                                int _pricePerUnit,
                                uint _vintage,
                                InventoryStatus _status,
                                uint _createdDate,
                                address _newOwner
                                ) returns (uint256, address) {
        string _organization = getOrganization(_newOwner);

        Product_4 product = Product_4(_productAddress);
        
        
        (uint256 status, address inventoryAddress) = product.addInventory(
                                                        _quantity,
                                                        _pricePerUnit,
                                                        _vintage,
                                                        _status,
                                                        _createdDate,
                                                        _newOwner
                                                    );

        orgxProductxVintagexPricexInventory[_organization][_productAddress][_vintage][_pricePerUnit] = inventoryAddress;

        return (status, inventoryAddress);
        
    }

    function resellInventory(
                        address _existingInventory,
                        int quantity,
                        uint price,
                        address _seller
                        ) returns (uint256, address) {

        Inventory_3 existingInventory = Inventory_3(_existingInventory);
        if(quantity>existingInventory.availableQuantity || quantity<=0)
        {
            return (RestStatus.BAD_REQUEST, address(0));
        }

        uint256 isUpdated = existingInventory.updateQuantityForResell(_quantity);
        (uint256 status, address inventoryAddress) = product.addInventory(
                                                                        existingInventory.productId(),
                                                                        quantity,
                                                                        price,
                                                                        existingInventory.vintage(),
                                                                        InventoryStatus.PUBLISHED,
                                                                        block.timestamp,
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

    function checkForInventory(
        uint _vintage,
        address _product,
        int _pricePerUnit,
        address _owner
    ) public returns (address) 
    
    {
        string _organization = getOrganization(_owner);

        if((_vintage !=0)  &&
            (orgxProductxVintagexPricexInventory[_organization][_product][_vintage][_pricePerUnit]!= address(0)) )
                {
                    return orgxProductxVintagexPricexInventory[_organization][_product][_vintage][_pricePerUnit];
                }
        return address(0);
    }
}
