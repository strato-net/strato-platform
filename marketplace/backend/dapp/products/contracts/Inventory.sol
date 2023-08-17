 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "/dapp/products/contracts/InventoryStatus.sol";

/// @title A representation of Inventory assets
contract Inventory_2 is InventoryStatus{

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;
                                                           
    address public productId;                                  
    string public category;                                  
    uint public purchasedQuantity;                              
    int public quantity;                                          
    int public pricePerUnit;                                   
    uint public vintage;                                        
    int public availableQuantity;                               
    InventoryStatus public status;                              
    uint public createdDate;
    uint public retiredQuantity;
                                                              
                                                                
    constructor(
            string _category
        ,   int _quantity
        ,   int _pricePerUnit
        ,   uint _vintage
        ,   InventoryStatus _status
        ,   uint _createdDate
        ,   address _owner
    ) public {
        owner = _owner;

        productId = msg.sender;
        category = _category;
        purchasedQuantity = 0;
        quantity = _quantity;
        pricePerUnit = _pricePerUnit;
        vintage = _vintage;
        availableQuantity = _quantity;
        status = _status;
        createdDate = _createdDate;
        retiredQuantity = 0;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    function update(
        int _pricePerUnit
    ,   InventoryStatus _status
    ,   uint _scheme
    ) returns (uint) {
      if(ownerOrganization != getUserOrganization(tx.origin)){
        return RestStatus.FORBIDDEN;
      }

      if (_scheme == 0) {
        return RestStatus.OK;
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        pricePerUnit = _pricePerUnit;
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        status = _status;
      }

      return RestStatus.OK;
    }    

    function updateQuantity(int _quantity) returns(uint){
      // if (tx.origin != owner) { return RestStatus.FORBIDDEN; }
      // if(_quantity > quantity){
      //   return RestStatus.BAD_REQUEST;
      // }
      availableQuantity = _quantity;
      return RestStatus.OK;
    }

    function updateQuantityForVintages(int _quantity) returns(uint){
      quantity = _quantity;
      availableQuantity = _quantity;
      return RestStatus.OK;
    }

    // Get the userOrganization
    function getUserOrganization(address caller) public returns (string) {
      mapping(string => string) ownerCert = getUserCert(caller);
      string userOrganization = ownerCert["organization"];
      return userOrganization;
    }
}
