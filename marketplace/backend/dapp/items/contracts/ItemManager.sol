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

        Item_4 itemAddr = new Item_4(
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
            Item_4 item = Item_4(_itemsAddress[i]);
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
        Item_4 item = Item_4(_itemAddress[0]);
        Product_4 product;
        Inventory_2 inventory;

        Product_4 oldProduct = Product_4(item.productId());
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
            product = Product_4(addr);
        } else {
            product = Product_4(productAddress);
        }

        Inventory_2 oldInventory = Inventory_2(item.inventoryId());

        address uniqueInventoryAddress = _productManager.checkForInventory(
                                                                            oldInventory.vintage(),
                                                                            productAddress,
                                                                            oldInventory.pricePerUnit(),
                                                                            _newOwner
                                                                            );
                                                                            
         //if no inventory is created before && vintage is invalid                                                             );
        if(uniqueInventoryAddress == address(0)) 
        {
            (uint256 status, address inventoryAddr)= _productManager.addInventoryForBuyer(
                                                                                    address(product),
                                                                                    _newQuantity,
                                                                                    oldInventory.pricePerUnit(),
                                                                                    oldInventory.vintage(),
                                                                                    InventoryStatus.UNPUBLISHED,
                                                                                    block.timestamp,
                                                                                    _newOwner
                                                                                );
            inventory = Inventory_2(inventoryAddr);

                   
        }else{
            //inventory retreived
            Inventory_2 inventoryToBeAdded = Inventory_2(uniqueInventoryAddress);
            int availableQuantity = inventoryToBeAdded.availableQuantity();
            //quantity updated
            uint256 status = inventoryToBeAdded.updateQuantityForVintages(availableQuantity+_newQuantity);
            inventory = inventoryToBeAdded;

            //return existing product, updated inventory
            return (address(product),address(inventory));
        }

        for (uint i = 0; i < _itemAddress.length; i++) {
            Item_4 _item = Item_4(_itemAddress[i]);
            if (oldInventory.availableQuantity() == _newQuantity) {
                _item.transferOwnership(
                    _newOwner,
                    address(product),
                    address(inventory)
                );
            } else {
                Item_4 itemAddr = new Item_4(
                    _item.productId(),
                    _item.inventoryId(),
                    _item.batchSerializationNumber(),
                    oldInventory.availableQuantity(),
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

                _item.updateQuantity(_newQuantity);

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
