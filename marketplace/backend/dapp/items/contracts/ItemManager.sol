import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/Item.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/ProductManager.sol";

/// @title A representation of ItemManager to manage items
contract ItemManager is ItemStatus, InventoryStatus {
    mapping(address => address) private itemProductIdMapping;
    mapping(address => address) private itemInventoryIdMapping;

    function addItem(
        address _productId,
        address _inventoryId,
        string _batchSerializationNumber,
        int _quantity,
        ItemStatus _status,
        uint _createdDate
    ) public returns (uint, string) {
        string itemAddresses = "";

        Item_3 itemAddr = new Item_3(
            _productId,
            _inventoryId,
            _batchSerializationNumber,
            _quantity,
            _status,
            _createdDate
        );

        address itemContractAddress = address(itemAddr);
        itemAddr.generateOwnershipHistory(
            "",
            itemAddr.ownerOrganization(),
            _createdDate,
            itemContractAddress
        );

        itemProductIdMapping[itemContractAddress] = _productId;
        itemInventoryIdMapping[itemContractAddress] = _inventoryId;
        itemAddresses += string(address(itemAddr)) + ",";
        return (RestStatus.OK, itemAddresses);
    }

    function updateItem(
        address[] _itemsAddress,
        ItemStatus _status,
        uint _scheme
    ) public returns (uint) {
        for (uint256 i = 0; i < _itemsAddress.length; i++) {
            Item_3 item = Item_3(_itemsAddress[i]);
            item.update(_status, _scheme);
        }
        return (RestStatus.OK);
    }

    function transferOwnership(
        address[] _itemsAddress,
        address _newOwner,
        address _dappAddress,
        int _newQuantity
    ) public returns (uint, address, address) {
        string itemAddresses = "";

        // get Dapp contract from dapp chain
        Dapp dapp = Dapp(address(_dappAddress));
        ProductManager productManager = dapp.productManager();

        (address productId, address inventoryId) = getProductAndInventory(
            productManager,
            _itemsAddress,
            _newOwner,
            _newQuantity
        );

        if (productId == address(0) || inventoryId == address(0)) {
            return (RestStatus.BAD_REQUEST, productId, inventoryId);
        } else {
            return (RestStatus.OK, productId, inventoryId);
        }
    }

    function getProductAndInventory(
        ProductManager _productManager,
        address[] _itemAddress,
        address _newOwner,
        int _newQuantity
    ) public returns (address, address) {
        Item_3 item = Item_3(_itemAddress[0]);
        Product_3 product;
        Inventory inventory;

        Product_3 oldProduct = Product_3(item.productId());
        address productAddress = _productManager.checkForProduct(
            oldProduct.uniqueProductCode(),
            _newOwner
        );

        if (productAddress == address(0)) {
            address addr = _productManager.addProductForBuyer(
                oldProduct.name(),
                oldProduct.description(),
                oldProduct.uniqueProductCode(),
                oldProduct.imageKey(),
                oldProduct.isActive(),
                oldProduct.category(),
                block.timestamp,
                _newOwner
            );
            product = Product_3(addr);
        } else {
            product = Product_3(productAddress);
        }

        Inventory oldInventory = Inventory(item.inventoryId());

        (uint status, address inventory) = product.addInventory(
            _newQuantity,
            oldInventory.pricePerUnit(),
            oldInventory.vintage(),
            InventoryStatus.UNPUBLISHED,
            block.timestamp,
            _newOwner
        );

        for (uint i = 0; i < _itemAddress.length; i++) {
            Item_3 _item = Item_3(_itemAddress[i]);
            if (oldInventory.availableQuantity() == _newQuantity) {
                _item.transferOwnership(
                    _newOwner,
                    address(product),
                    address(inventory)
                );
            } else {
                Item_3 itemAddr = new Item_3(
                    _item.productId(),
                    _item.inventoryId(),
                    _item.batchSerializationNumber(),
                    _item.quantity(),
                    _item.status(),
                    block.timestamp
                );
                address itemContractAddress = address(itemAddr);
                itemAddr.generateOwnershipHistory(
                    "",
                    _item.ownerOrganization(),
                    block.timestamp,
                    itemContractAddress
                );
                itemProductIdMapping[itemContractAddress] = _item.productId();
                itemInventoryIdMapping[itemContractAddress] = _item
                    .inventoryId();

                _item.transferOwnership(
                    _newOwner,
                    address(product),
                    address(inventory)
                );
            }
        }

        return (address(product), address(inventory));
    }
}
