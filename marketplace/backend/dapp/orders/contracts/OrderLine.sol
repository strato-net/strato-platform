 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "./OrderLineItem.sol";
import "./Order.sol";
import "./OrderStatus.sol";
import "/dapp/items/contracts/ItemStatus.sol";

/// @title A representation of OrderLine assets
contract OrderLine_2 is ItemStatus,OrderStatus{

    address public owner;
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    address public orderAddress;
    address public productId;
    address public inventoryId;
    uint public quantity;
    uint public pricePerUnit;
    uint public tax;
    uint public shippingCharges;
    uint public createdDate;
    bool public isSerialUploaded;

    address[] public itemsAddresses;
    constructor(
            address _orderAddress
        ,   address _productId
        ,   address _inventoryId
        ,   uint _quantity
        ,   uint _pricePerUnit
        ,   uint _shippingCharges
        ,   uint _tax
        ,   uint _createdDate
    ) public {
        owner = tx.origin;

        orderAddress = _orderAddress;
        productId = _productId;
        inventoryId = _inventoryId;
        quantity = _quantity;
        pricePerUnit = _pricePerUnit;
        shippingCharges = _shippingCharges;
        tax = _tax;
        createdDate = _createdDate;
        isSerialUploaded = false;

        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    modifier onlyOwnerOrganization() {
        mapping(string => string) ownerCert = getUserCert(owner);
        string assetOwner = ownerCert["organization"];
        require(assetOwner == ownerOrganization, "You are not the owner.");
    _;
    }

    // Add the orderLineItem of a order
    function addOrderLineItems(address _orderLineId,string[] _items, uint _createdDate ) public  returns(uint256, string,string){
      
      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      string orderLineItems="";
      string items="";
      uint orderLineItemCounter = 0;

      // getting the order chain's governance contract
      Order order = Order(orderAddress);


      // if(assetOwnerOrganization != ownerOrganization){
      //   return (RestStatus.FORBIDDEN,address(0));
      // }
      for(uint i=0;i<_items.length;i++){
        if(address(_items[i]) == address(0)){
          return (RestStatus.NOT_FOUND,string(address(0)),string(address(0)));
        }

        Art item = Art(address(_items[i]));

        // check published status of items
        if(item.status() != ItemStatus.PUBLISHED){
          return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
        }

        // check the item's owner
        if(assetOwnerOrganization != item.ownerOrganization()){
          return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
        } 

        OrderLineItem orderLineItem=new OrderLineItem(_orderLineId, string(address(_items[i])), item.serialNumber(), _createdDate, address(item.sale()));
        orderLineItems += string(address(orderLineItem)) + ",";
        items += string(address(item)) + ",";
        itemsAddresses.push(address(item));
        
        if(address(orderLineItem) !=address(0)){
          orderLineItemCounter += 1;
        }
      }
      if(orderLineItemCounter != _items.length){
        return (RestStatus.BAD_REQUEST,string(address(0)),string(address(0)));
      }
      isSerialUploaded=true;
      return (RestStatus.OK,orderLineItems,items);
    }

}


