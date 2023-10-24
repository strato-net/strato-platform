import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "../../../products/contracts/MarketplaceItem.sol";
import "./OrderStatus.sol";
import "/mercata-base-contracts/Templates/Sale/Sale.sol";

/// @title A representation of Order assets
contract MarketplaceSale is OrderStatus, Sale {
    //Looks like there is a one to many relationship between Order and OrderLine
    OrderLine[] orderLines;
    Order order;

    struct Order {
      address public owner; 
      string public ownerOrganization;
      string public ownerOrganizationalUnit;
      string public ownerCommonName;

      string public id;
      string public buyerOrganization;
      string public sellerOrganization;
      uint public orderDate;
      uint public orderTotal;
      uint public orderShippingCharges;
      OrderStatus public status;
      uint public paymentDate;
      uint public amountPaid;
      uint public fullfilmentDate;
      string public buyerComments;
      string public sellerComments;
      uint public createdDate;
      string public paymentSessionId;
      address public shippingAddress;
    }

    struct OrderLine {
      address public owner;
      string public ownerOrganization;
      string public ownerOrganizationalUnit;
      string public ownerCommonName;
      string public orderId;

      address public productId;
      address public inventoryId;
      uint public quantity;
      uint public pricePerUnit;
      uint public tax;
      uint public shippingCharges;
      uint public createdDate;
      bool public isSerialUploaded;
    }

    struct OrderLineItem {
      address public owner;
      string public ownerOrganization;
      string public ownerOrganizationalUnit;
      string public ownerCommonName;

      address public orderLineId;
      string public itemId;
      string public itemSerialNumber;
      uint public createdDate;
    }

    constructor(
      string _orderId
    , string _buyerOrganization
    , string _sellerOrganization
    , uint _orderDate
    , uint _orderTotal
    , uint _orderShippingCharges
    , uint _amountPaid
    , string _buyerComments
    , string _sellerComments
    , uint _createdDate
    , string _paymentSessionId
    , address _shippingAddress
    ) public {
        order.owner = tx.origin;
        order.orderId = _orderId;
        order.buyerOrganization = _buyerOrganization;
        order.sellerOrganization = _sellerOrganization;
        order.orderDate = _orderDate;
        order.orderTotal = _orderTotal;
        order.orderShippingCharges = _orderShippingCharges;
        order.status = OrderStatus.AWAITING_FULFILLMENT;
        order.order_amountPaid = _amountPaid;
        order.buyerComments = _buyerComments;
        order.sellerComments = _sellerComments;
        order.createdDate = _createdDate;
        order.paymentSessionId = _paymentSessionId;
        order.shippingAddress = _shippingAddress;
        
        mapping(string => string) ownerCert = getUserCert(owner);
        order.ownerOrganization = ownerCert["organization"];
        order.ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        order.ownerCommonName = ownerCert["commonName"];
    }

    function updateBuyerDetails(
      OrderStatus _status
    , string _buyerComments
    , uint _scheme
    ) public returns (uint, string, string) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != buyerOrganization){
        return (RestStatus.FORBIDDEN,"","");
      }

       // check for open status to closed status
     if(_status == OrderStatus.CANCELED){
       return getInventoriesAndAvailableQuantity(_status,_buyerComments,orderLines,true);
     }

      if (_scheme == 0) {
        return (RestStatus.OK,"","");
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }

      if ((_scheme & (1 << 1)) == (1 << 1)) {
        order.buyerComments = _buyerComments;
      }

      return (RestStatus.OK,string(address(0)),string(address(0)));
    }

    function updateSellerDetails(
      OrderStatus _status
    , uint _fullfilmentDate
    , string _sellerComments
    , uint _scheme
    ) public returns (uint, string, string) {
      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != sellerOrganization){
        return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
      } 

      // check for open status to closed status
      if (_status == OrderStatus.CLOSED) {
        for (uint i=0; i < orderLines.length; i++) {
          OrderLine orderLine = orderLines[i];
          // if(!orderLine.isSerialUploaded()){
          //   return (RestStatus.BAD_REQUEST,string(address(0)),string(address(0)));
          // }
        }
        order.fullfilmentDate = _fullfilmentDate;
        return getInventoriesAndAvailableQuantity(_status, _sellerComments, orderLines, false);
      }

      // check for open status to closed status
      if(_status == OrderStatus.CANCELED){
        return getInventoriesAndAvailableQuantity(_status, _sellerComments, orderLines, false);
      }

      if (_scheme == 0) {
        return (RestStatus.OK,"","");
      }
      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        order.fullfilmentDate = _fullfilmentDate;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        order.sellerComments = _sellerComments;
      }

      return (RestStatus.OK,"","");
    }

    // Add the orderLine of a order
    function addOrderLine(
    , address _productId
    , address _inventoryId
    , uint _quantity
    , uint _pricePerUnit
    , uint _shippingCharges
    , uint _tax
    , int _createdDate
    ) public returns (uint256, address) {
      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != order.buyerOrganization){
        return (RestStatus.FORBIDDEN,address(0));
      } 

      OrderLine orderLine = OrderLine(
        tx.origin,
        ownerCert["organization"],
        ownerCert["organizationalUnit"],
        ownerCert["commonName"],
        _orderId, 
        _productId, 
        _inventoryId, 
        _quantity, 
        _pricePerUnit, 
        _shippingCharges, 
        _tax, 
        _createdDate, 
        false
      );
      orderLines.push(orderLine);
      return (RestStatus.OK,address(orderLine));
    }


    // Add the orderLineItem of a order
    function addOrderLineItems(
      , address _orderLineId
      , string[] _items
      , uint _createdDate
      ) public returns (uint256, string, string) {
      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      string orderLineItems="";
      string items="";
      uint orderLineItemCounter = 0;

      // if(assetOwnerOrganization != ownerOrganization){
      //   return (RestStatus.FORBIDDEN,address(0));
      // }
      for (uint i = 0; i < _items.length; i++) {
        if(address(_items[i]) == address(0)) {
          return (RestStatus.NOT_FOUND, string(address(0)), string(address(0)));
        }

        MarketplaceItem mktItem = MarketplaceItem(address(_items[i]));

        // check published status of items
        if (mktItem.item.status() != ItemStatus.PUBLISHED) {
          return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
        }

        // check the item's owner
        if (assetOwnerOrganization != item.ownerOrganization()) {
          return (RestStatus.FORBIDDEN, string(address(0)), string(address(0)));
        } 

        OrderLineItem orderLineItem = OrderLineItem(
          _orderLineId, 
          string(address(_items[i])), 
          mktItem.item.serialNumber(), 
          _createdDate
        );
        orderLineItems += string(address(orderLineItem)) + ",";
        items += string(address(item)) + ",";

        if(address(orderLineItem) != address(0)) { orderLineItemCounter += 1; }
      }

      if(orderLineItemCounter != _items.length) {
        return (RestStatus.BAD_REQUEST,string(address(0)),string(address(0)));
      }
      // todo: orderLine.isSerialUploaded=true;
      // isSerialUploaded = true;
      updateOrderStatus(OrderStatus.AWAITING_SHIPMENT);
      return (RestStatus.OK,orderLineItems,items);
    }
    

    // Add the orderLineItem of a order
    function addOrderLineItems(
      , address _orderLineId
      , string[] _items
      , uint _createdDate
      ) public returns (uint256, string, string) {
      
      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      string orderLineItems="";
      string items="";
      uint orderLineItemCounter = 0;

      // if(assetOwnerOrganization != ownerOrganization){
      //   return (RestStatus.FORBIDDEN,address(0));
      // }
      for(uint i=0;i<_items.length;i++) {
        if(address(_items[i]) == address(0)) {
          return (RestStatus.NOT_FOUND, string(address(0)), string(address(0)));
        }

        MarketplaceItem mktItem = MarketplaceItem(address(_items[i]));

        // check published status of items
        if(item.status() != ItemStatus.PUBLISHED){
          return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
        }

        // check the item's owner
        if(assetOwnerOrganization != item.ownerOrganization()){
          return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
        } 

        OrderLineItem orderLineItem = OrderLineItem(
          tx.origin,
          owner["organization"],
          ownerCert["organizationalUnit"],
          ownerCert["commonName"]],
          _orderLineId, 
          string(address(_items[i])), 
          mktItem.item.serialNumber(), 
          _createdDate
        );
        orderLineItems += string(address(orderLineItem)) + ",";
        items += string(address(mktItem)) + ",";
        // itemsAddresses.push(address(mktItem));
        
        // if(address(orderLineItem) !=address(0)){
        //   orderLineItemCounter += 1;
        // }
      }

      if(orderLineItemCounter != _items.length){
        return (RestStatus.BAD_REQUEST,string(address(0)),string(address(0)));
      }
      // orderLineItem.isSerialUploaded=true;
      updateOrderStatus(OrderStatus.AWAITING_SHIPMENT);
      return (RestStatus.OK,orderLineItems,items);
    }

    function changeStatus(OrderStatus newStatus) public {
      if(status == OrderStatus.AWAITING_FULFILLMENT){
          if (newStatus == OrderStatus.AWAITING_SHIPMENT) {
              order.status = newStatus;
          } else if (newStatus == OrderStatus.CANCELED) {
              order.status = newStatus;
          }
      }else if(status == OrderStatus.AWAITING_SHIPMENT){
          if (newStatus == OrderStatus.CLOSED) {
              order.status = newStatus;
          } 
      }
    }

    function updateOrderStatus(OrderStatus _status) public{
      order.status = _status;
    }

    function getInventoriesAndAvailableQuantity(
        OrderStatus _status
      , string _comments
      , OrderLine _orderLines
      , bool _isBuyer
      ) public returns (uint, string, string) {

      changeStatus(_status);

      if (_isBuyer) {
        order.buyerComments = _comments;
      } else{
        order.sellerComments = _comments;
      }

      string inventories = "";
      string orderLineQuantities = "";

      for(uint i=0; i < _orderLines.length; i++) {
        OrderLine_2 orderLine = _orderLines[i];
        MarketplaceItem inventory = MarketplaceItem(address(orderLine.inventoryId()));
        inventories += string(address(orderLine.inventoryId())) + ",";
        orderLineQuantities += string(orderLine.quantity()) + ",";
      }
      return (RestStatus.OK,inventories,orderLineQuantities);
    }
 