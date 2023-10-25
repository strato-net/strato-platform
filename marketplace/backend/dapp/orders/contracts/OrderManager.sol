 

import "/blockapps-sol/lib/rest/contracts/RestStatus.sol";
import "/dapp/orders/contracts/Order.sol";
import "./OrderStatus.sol";
import "/dapp/orders/contracts/OrderLine.sol";

contract OrderManager is RestStatus,OrderStatus{
  
    function createOrder(    
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
        ,   address _shippingAddress) public returns (uint256, address){
        Mem_Order order = new Mem_Order( _orderId, _buyerOrganization,_sellerOrganization, _orderDate,_orderTotal,_orderShippingCharges,_status,_amountPaid,_buyerComments,_sellerComments,_createdDate,_paymentSessionId,_shippingAddress);
        return (RestStatus.CREATED, address(order));
    }

    function updateBuyerDetails(address _orderAddress,OrderStatus _status,string _buyerComments,uint _scheme) public returns (uint,string,string) {
        Mem_Order order = Mem_Order(_orderAddress);
        return order.updateBuyerDetails(_status,_buyerComments,_scheme);
    }

    function updateSellerDetails(address _orderAddress,OrderStatus _status,uint _fullfilmentDate,string _sellerComments,uint _scheme) public  returns (uint,string,string){
         Mem_Order order = Mem_Order(_orderAddress);
         return order.updateSellerDetails(_status,_fullfilmentDate,_sellerComments,_scheme);
    }

    function getInventoriesAndAvailableQuantity(address _orderAddress,OrderStatus _status,string _comments,address[] _orderLines,bool _isBuyer)  public returns (uint,string,string) {
        Mem_Order order = Mem_Order(_orderAddress);
        return order.getInventoriesAndAvailableQuantity(_status,_comments,_orderLines,_isBuyer);
    }

    function addOrderLine(address _orderAddress,address _productId, address _inventoryId, uint _quantity, uint _pricePerUnit, uint _shippingCharges
    , uint _tax, uint _createdDate ) public  returns(uint256, address){
        Mem_Order order = Mem_Order(_orderAddress);
        return order.addOrderLine(_orderAddress,_productId,_inventoryId,_quantity,_pricePerUnit,_shippingCharges,_tax,_createdDate);
    }

    function addOrderLineItems(address _orderLineId,string[] _items, uint _createdDate) public  returns(uint256, string, string){
        Mem_OrderLine_2 orderLine = Mem_OrderLine_2(_orderLineId);
        return orderLine.addOrderLineItems(_orderLineId,_items,_createdDate);
    }
}
