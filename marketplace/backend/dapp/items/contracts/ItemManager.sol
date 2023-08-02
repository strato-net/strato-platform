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
        string _creditBatchSerialization,
        int _quantity,
        ItemStatus _status,
        uint _createdDate
    ) public returns (uint, string) {
        string itemAddresses = "";

        Item_3 itemAddr = new Item_3(
            _productId,
            _inventoryId,
            _creditBatchSerialization,
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
        address _dappAddress
    ) public returns (uint) {
        string itemAddresses = "";
        // if(_itemsAddress.length <= 0){
        //     return (RestStatus.BAD_REQUEST,address(0),address(0));
        // }
        // get Dapp contract from dapp chain
        Dapp dapp = Dapp(address(_dappAddress));
        ProductManager productManager = dapp.productManager();

        return (RestStatus.OK);
    }
}
