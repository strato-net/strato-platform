 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/items/contracts/Item.sol";
import "/dapp/items/contracts/ItemStatus.sol";
import "/dapp/products/contracts/InventoryStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/ProductManager.sol";
import "/dapp/permissions/app/contracts/AppPermissionManager.sol";

/// @title A representation of ItemManager to manage items
contract ItemManager is ItemStatus,InventoryStatus{

    // check if the serial number is mapping(serialNumber => UPC ) uniqueSerialNumberByUPC;
    mapping(string => uint) private uniqueSerialNumberByUPC;
    mapping(address => address) private itemProductIdMapping;
    mapping(address => address) private itemInventoryIdMapping;
    AppPermissionManager appPermissionManager;

    struct ItemObject {
        uint itemNumber;
        string serialNumber;
        string[] rawMaterialProductName;
        string[] rawMaterialSerialNumber;
        string[] rawMaterialProductId;
    }
    constructor(address _permissionManager) public {
         appPermissionManager=AppPermissionManager(_permissionManager);
    }

    // TODO to be removed after product transformation implementation
    // function addItem(string _appChainId, address _productId, address _inventoryId, string _uniqueProductCode, string[] _serialNumber, ItemStatus _status, string _comment, uint _createdDate) public returns (uint, string, string) {
    //         string itemAddresses= "";
    //         string repeatedSerialNumbers= "";

    //         uint startIndex=0;
    //         uint endIndex=0;

    //     for (uint256 i = 0; i < _serialNumber.length; i++) {
    //        string currentSerialNumber = _serialNumber[i];
    //        string exisitngUPC = uniqueSerialNumberByUPC[currentSerialNumber];
           
    //        if(exisitngUPC == _uniqueProductCode){
    //             repeatedSerialNumbers += currentSerialNumber + ",";
            
    //         }else{

    //             Item_3 itemAddr= new Item_3(_appChainId, _productId, _inventoryId, currentSerialNumber, _status, _comment, _createdDate);

    //             address itemContractAddress= address(itemAddr);
    //             itemAddr.generateOwnershipHistory("",itemAddr.ownerOrganization(), _createdDate, itemContractAddress);
    //             uniqueSerialNumberByUPC[currentSerialNumber] = _uniqueProductCode;
    //             itemProductIdMapping[itemContractAddress] = _productId;
    //             itemInventoryIdMapping[itemContractAddress] = _inventoryId;
    //             itemAddresses += string(address(itemAddr)) + ",";
    //         }
    //     } 
    //     return (RestStatus.OK, itemAddresses, repeatedSerialNumbers);
    // }

    function addItem(string _appChainId, address _productId, address _inventoryId, uint _uniqueProductCode, ItemObject[] _itemObject, ItemStatus _status, string _comment, uint _createdDate) public returns (uint, string, string) {
            string itemAddresses= "";
            string repeatedSerialNumbers= "";

        for (uint256 i = 0; i < _itemObject.length; i++) {
           string currentSerialNumber = _itemObject[i].serialNumber;
           uint exisitngUPC = uniqueSerialNumberByUPC[currentSerialNumber];
           
           if(exisitngUPC == _uniqueProductCode){
                repeatedSerialNumbers += currentSerialNumber + ",";
            
            }else{
                Item_3 itemAddr= new Item_3(_appChainId, _productId, _uniqueProductCode, _inventoryId, currentSerialNumber, _status, _comment, _itemObject[i].rawMaterialProductName, _itemObject[i].rawMaterialSerialNumber, _itemObject[i].rawMaterialProductId, _itemObject[i].itemNumber,
                _createdDate);

                address itemContractAddress= address(itemAddr);
                itemAddr.generateOwnershipHistory("",itemAddr.ownerOrganization(), _createdDate, itemContractAddress);
               
                uniqueSerialNumberByUPC[currentSerialNumber] = _uniqueProductCode;
                itemProductIdMapping[itemContractAddress] = _productId;
                itemInventoryIdMapping[itemContractAddress] = _inventoryId;
                itemAddresses += string(address(itemAddr)) + ",";
            }
        } 
        return (RestStatus.OK, itemAddresses, repeatedSerialNumbers);
    }

    function updateItem (address[] _itemsAddress, ItemStatus _status, string _comment, uint _scheme) 
        public returns (uint) {

        for(uint256 i = 0; i < _itemsAddress.length; i++){
            Item_3 item = Item_3(_itemsAddress[i]);
            item.update(_status, _comment, _scheme);
        }
        return (RestStatus.OK);
    }

    function addEvent (address[] _itemsAddress, string _appChainId, address _eventTypeId, string _eventBatchId, 
                       uint _date, string _summary, address _certifier, uint _createdDate) 
        public returns (uint, string) {
            if(!appPermissionManager.canCreateEvent(tx.origin)){
                return (RestStatus.UNAUTHORIZED,"0");
            }
        string eventAddresses = "";

        for(uint256 i = 0; i < _itemsAddress.length; i++){
            address _itemAddress = _itemsAddress[i];
            Item_3 item = Item_3(_itemAddress);
            string _itemSerialNumber = item.serialNumber();
            
            Event_1 eventAddr = new Event_1(_appChainId, _eventTypeId, _eventBatchId, _itemSerialNumber, 
            _itemAddress, _date, _summary, _certifier, _createdDate);

            eventAddresses += string(address(eventAddr)) + ",";
        }
        return (RestStatus.CREATED, eventAddresses);
    }

    function certifyEvent (address[] _eventAddress, string _certifierComment, uint _certifiedDate, uint _scheme) 
        public returns (uint, string) {
        if(!appPermissionManager.canCertifyEvent(tx.origin)){
            return (RestStatus.UNAUTHORIZED,"0");
        }
        for(uint256 i = 0; i < _eventAddress.length; i++){
            Event_1 eventAddr = Event_1(_eventAddress[i]);
            uint status = eventAddr.certify(_certifierComment, _certifiedDate, _scheme);
            if(status == RestStatus.FORBIDDEN) {
            // break the loop and return FORBIDDEN status
            return (RestStatus.FORBIDDEN, "User should be the Assigned Certifier");
            }
        }
        return (RestStatus.OK, "event has been certified");
    }


    function transferOwnership (address[] _itemsAddress, address _newOwner) public returns (uint,address,address) {
        string itemAddresses = "";
        // if(_itemsAddress.length <= 0){
        //     return (RestStatus.BAD_REQUEST,address(0),address(0));
        // }
        // get Dapp contract from dapp chain
        Dapp dapp = Dapp(address(0x100));
        ProductManager productManager = dapp.productManager();

        (address productId, address inventoryId) = getProductAndInventory(productManager, _itemsAddress,_newOwner);

        return (RestStatus.OK, productId,inventoryId);
    }

   function getProductAndInventory(ProductManager _productManager, address[] _itemAddress,address _newOwner) public returns (address, address) {
        Item_3 item = Item_3(_itemAddress[0]);
        Product_3 product;
        Inventory inventory;

        Product_3 oldProduct = Product_3(item.productId());
        address productAddress = _productManager.checkForProduct(address(oldProduct), oldProduct.uniqueProductCode(),_newOwner);

        product = (productAddress == address(0)) 
            ? new Product_3(oldProduct.appChainId(), oldProduct.name(), oldProduct.description(), oldProduct.manufacturer(), oldProduct.unitOfMeasurement(), oldProduct.userUniqueProductCode(), oldProduct.uniqueProductCode(), oldProduct.leastSellableUnit(), oldProduct.imageKey(), oldProduct.isActive(), oldProduct.categoryId(), oldProduct.subCategoryId(), block.timestamp,_newOwner)
            : Product_3(productAddress);

        Inventory oldInventory = Inventory(item.inventoryId());

        (uint status,address inventory) = product.addInventory( _itemAddress.length, oldInventory.pricePerUnit(), oldInventory.batchId(), InventoryStatus.UNPUBLISHED, block.timestamp,_newOwner);
        
        for (uint i = 0; i < _itemAddress.length; i++) {
            Item_3 _item = Item_3(_itemAddress[i]);
            _item.transferOwnership(_newOwner, address(product), address(inventory));
           
        }

        return (address(product), address(inventory));
    }


}