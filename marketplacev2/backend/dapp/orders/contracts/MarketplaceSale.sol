 import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "../../../products/contracts/MarketplaceItem.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";

/// @title A representation of Order assets
contract MarketplaceSale is OrderStatus {

    address public order_owner; 
    string public order_ownerOrganization;
    string public order_ownerOrganizationalUnit;
    string public order_ownerCommonName;

    string public order_orderId;
    string public order_buyerOrganization;
    string public order_sellerOrganization;
    uint public order_orderDate;
    uint public order_orderTotal;
    uint public order_orderShippingCharges;
    OrderStatus public order_status;
    uint public order_paymentDate;
    uint public order_amountPaid;
    uint public order_fullfilmentDate;
    string public order_buyerComments;
    string public order_sellerComments;
    uint public order_createdDate;
    string public order_paymentSessionId;
    address public order_shippingAddress;

    address[] order_orderLines; //Looks like there is a one to many relationship between Order and OrderLine


    constructor(
            string _orderId
        ,   string _buyerOrganization
        ,   string _sellerOrganization
        ,   uint _orderDate
        ,   uint _orderTotal
        ,   uint _orderShippingCharges
        ,   OrderStatus _status
        ,   uint _amountPaid
        ,   string _buyerComments
        ,   string _sellerComments
        ,   uint _createdDate
        ,   string _paymentSessionId
        ,   address _shippingAddress
    ) public {
        order_owner = tx.origin;

        order_orderId = _orderId;
        order_buyerOrganization = _buyerOrganization;
        order_sellerOrganization = _sellerOrganization;
        order_orderDate = _orderDate;
        order_orderTotal = _orderTotal;
        order_orderShippingCharges = _orderShippingCharges;
        order_status = OrderStatus.AWAITING_FULFILLMENT;
        order_order_amountPaid = _amountPaid;
        order_buyerComments = _buyerComments;
        order_sellerComments = _sellerComments;
        order_createdDate = _createdDate;
        order_paymentSessionId= _paymentSessionId;
        order_shippingAddress= _shippingAddress;
        
        mapping(string => string) ownerCert = getUserCert(owner);
        order_ownerOrganization = ownerCert["organization"];
        order_ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        order_ownerCommonName = ownerCert["commonName"];
        

    }

    function updateBuyerDetails(
        OrderStatus _status
        ,   string _buyerComments
    ,uint _scheme
    ) public returns (uint,string,string) {

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
        order_buyerComments = _buyerComments;
      }

      return (RestStatus.OK,string(address(0)),string(address(0)));
    }

    function updateSellerDetails(
        OrderStatus _status
        ,   uint _fullfilmentDate
        ,   string _sellerComments
    ,uint _scheme
    ) public  returns (uint,string,string) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != sellerOrganization){
        return (RestStatus.FORBIDDEN,string(address(0)),string(address(0)));
      } 

    // check for open status to closed status
     if(_status == OrderStatus.CLOSED){
       for(uint i=0;i<orderLines.length;i++){
        OrderLine_2 orderLine = OrderLine_2(orderLines[i]);
        // if(!orderLine.isSerialUploaded()){
        //   return (RestStatus.BAD_REQUEST,string(address(0)),string(address(0)));
        // }
      }
      order_fullfilmentDate = _fullfilmentDate;
      return getInventoriesAndAvailableQuantity(_status,_sellerComments,orderLines,false);
     }

      // check for open status to closed status
     if(_status == OrderStatus.CANCELED){
       return getInventoriesAndAvailableQuantity(_status,_sellerComments,orderLines,false);
     }


      if (_scheme == 0) {
        return (RestStatus.OK,"","");
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        order_fullfilmentDate = _fullfilmentDate;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        order_sellerComments = _sellerComments;
      }

      return (RestStatus.OK,"","");
    }

    // Add the orderLine of a order
    function addOrderLine(address _orderAddress, address _productId, address _inventoryId, uint _quantity, uint _pricePerUnit, uint _shippingCharges
, uint _tax, uint _createdDate ) public  returns(uint256, address){

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != buyerOrganization){
        return (RestStatus.FORBIDDEN,address(0));
      } 

      OrderLine_2 orderLine=new OrderLine_2(_orderAddress, _productId, _inventoryId, _quantity, _pricePerUnit, _shippingCharges
      , _tax, _createdDate);
      orderLines.push(address(orderLine));
      return (RestStatus.OK,address(orderLine));
    }

    function changeStatus(OrderStatus newStatus) public {
      if(status == OrderStatus.AWAITING_FULFILLMENT){
          if (newStatus == OrderStatus.AWAITING_SHIPMENT) {
              order_status = newStatus;
          } else if (newStatus == OrderStatus.CANCELED) {
              order_status = newStatus;
          }
      }else if(status == OrderStatus.AWAITING_SHIPMENT){
          if (newStatus == OrderStatus.CLOSED) {
              order_status = newStatus;
          } 
      }
    }

    function updateOrderStatus(OrderStatus _status) public{
      order_status = _status;
    }

    function getInventoriesAndAvailableQuantity(OrderStatus _status,string _comments,address[] _orderLines,bool _isBuyer) public returns(uint,string,string){

      changeStatus(_status);
      if(_isBuyer){
        order_buyerComments = _comments;
      }else{
        order_sellerComments = _comments;
      }
      string inventories = "";
      string orderLineQuantities = "";
      for(uint i=0;i<orderLines.length;i++){
        OrderLine_2 orderLine = OrderLine_2(address(orderLines[i]));
        MarketplaceItem inventory = MarketplaceItem(address(orderLine.inventoryId()));
        inventories += string(address(orderLine.inventoryId())) + ",";
        orderLineQuantities += string(orderLine.quantity()) + ",";
      }
      return (RestStatus.OK,inventories,orderLineQuantities);
  
    }

}