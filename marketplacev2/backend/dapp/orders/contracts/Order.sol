import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/dapp/contracts/Dapp.sol";
import "mercata-base-contracts/Templates/Sale/Sale.sol";
import "../../../products/contracts/Inventory.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";

/// @title A representation of Order assets
/// @author BlockApps Inc.
/// @notice This contract represents the sale of an Order on the marketplace
contract Order is OrderStatus, Sale {

    struct OrderLine {
      address public owner;
      string public ownerOrganization;
      string public ownerOrganizationalUnit;
      string public ownerCommonName;

      string public orderId;
      address public itemId;
      uint public quantity;
      uint public pricePerUnit;
      uint public tax;
      uint public shippingCharges;
      uint public createdDate;
      bool public isSerialUploaded;
    }

    address public owner; 
    string public ownerOrganization;
    string public ownerOrganizationalUnit;
    string public ownerCommonName;

    string public orderId;
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

    /// @dev A single order may have multiple order items within it
    OrderLine[] orderLines;

    constructor(
          string _orderId
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
        owner = tx.origin;

        orderId = _orderId;
        orderDate = _orderDate;
        orderTotal = _orderTotal;
        orderShippingCharges = _orderShippingCharges;
        status = OrderStatus.AWAITING_FULFILLMENT;
        amountPaid = _amountPaid;
        buyerComments = _buyerComments;
        sellerComments = _sellerComments;
        createdDate = _createdDate;
        paymentSessionId= _paymentSessionId;
        shippingAddress= _shippingAddress;
        
        mapping(string => string) ownerCert = getUserCert(owner);
        ownerOrganization = ownerCert["organization"];
        ownerOrganizationalUnit = ownerCert["organizationalUnit"];
        ownerCommonName = ownerCert["commonName"];
    }

    
    /// @notice Add the orderLine to this contract's Order order
    /// @param _itemId The id of the item
    /// @param _quantity The quantity of the item
    /// @param _pricePerUnit The price per unit of the item
    /// @param _shippingCharges The shipping charges of the item
    /// @param _tax The tax of the item
    /// @param _createdDate The created date of the item
    /// @return RestStatus HTTP status code
    function addOrderLine(
      , address _itemId
      , uint _quantity
      , uint _pricePerUnit
      , uint _shippingCharges
      , uint _tax
      , int _createdDate
      ) public returns (uint256) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != buyerOrganization){
        return (RestStatus.FORBIDDEN);
      } 

      OrderLine orderLine = OrderLine(
        tx.origin,
        ownerCert["organization"],
        ownerCert["organizationalUnit"],
        ownerCert["commonName"],
        orderId,
        _itemId, 
        _quantity, 
        _pricePerUnit, 
        _shippingCharges, 
        _tax, 
        _createdDate, 
        false
      );

      orderLines.push(orderLine);
      return RestStatus.OK
    }


    /// @notice Update order details from the buyer perspective
    /// @param _status The status of the order
    /// @param _buyerComments The buyer comments of the order
    /// @param _scheme The scheme of the order
    /// @return RestStatus HTTP status code
    function updateBuyerDetails(
        OrderStatus _status
      , string _buyerComments
      , uint _scheme
      ) public returns (uint) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];

      if(assetOwnerOrganization != buyerOrganization){
        return RestStatus.FORBIDDEN;
      }

      // check for open status to closed status
      if(_status == OrderStatus.CANCELED){
        return getInventoriesAndAvailableQuantity(_status,_buyerComments,orderLines,true);
      }

      if (_scheme == 0) {
        return RestStatus.OK
      }

      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }

      if ((_scheme & (1 << 1)) == (1 << 1)) {
        buyerComments = _buyerComments;
      }

      return RestStatus.OK;
    }

    /// @notice Update order details from the seller perspective
    /// @param _status The status of the order
    /// @param _fullfilmentDate The fullfilment date of the order
    /// @param _sellerComments The seller comments of the order
    /// @param _scheme The scheme of the order
    /// @return RestStatus HTTP status code
    function updateSellerDetails(
        OrderStatus _status
      , uint _fullfilmentDate
      , string _sellerComments
      , uint _scheme
      ) public returns (uint) {

      mapping(string => string) ownerCert = getUserCert(tx.origin);
      string assetOwnerOrganization = ownerCert["organization"];
      if(assetOwnerOrganization != sellerOrganization){
        return RestStatus.FORBIDDEN;
      } 

      // check for open status to closed status
      if (_status == OrderStatus.CLOSED) {
        for (uint i=0; i < orderLines.length; i++) {
          OrderLine orderLine = orderLines[i];
        }
        fullfilmentDate = _fullfilmentDate;
        return getInventoriesAndAvailableQuantity(_status, _sellerComments, orderLines, false);
      }

      // check for open status to closed status
      if (_status == OrderStatus.CANCELED){
        return getInventoriesAndAvailableQuantity(_status, _sellerComments, orderLines, false);
      }

      if (_scheme == 0) {
        return (RestStatus.OK);
      }
      if ((_scheme & (1 << 0)) == (1 << 0)) {
        changeStatus(_status);
      }
      if ((_scheme & (1 << 1)) == (1 << 1)) {
        fullfilmentDate = _fullfilmentDate;
      }
      if ((_scheme & (1 << 2)) == (1 << 2)) {
        sellerComments = _sellerComments;
      }

      return RestStatus.OK;
    }

    /// @notice Change the status of an order
    /// @param newStatus The status to change the order to
    function changeStatus(OrderStatus newStatus) public {
      status = _status;
    }

    /// @notice Get the inventory and available quantity of an order
    /// @param _status The status of the order
    /// @param _comments Update the comments of an order
    /// @param _isBuyer Whether or not the order is from the buyer
    /// @return RestStatus HTTP status code
    /// @return inventories The inventories of the order
    /// @return orderLineQuantities The order line quantities of the order
    function getInventoriesAndAvailableQuantity(
        OrderStatus _status
      , string _comments
      , bool _isBuyer
      ) public returns (uint, string, string) {

      changeStatus(_status);

      if (_isBuyer) {
        buyerComments = _comments;
      } else{
        sellerComments = _comments;
      }

      string inventories = "";
      string orderLineQuantities = "";

      for(uint i=0; i < orderLines.length; i++) {
        OrderLine orderLine = orderLines[i];
        MarketplaceItem inventory = MarketplaceItem(address(orderLine.inventoryId()));
        inventories += string(address(orderLine.inventoryId())) + ",";
        orderLineQuantities += string(orderLine.quantity()) + ",";
      }
      return (RestStatus.OK, inventories, orderLineQuantities);
    }
}